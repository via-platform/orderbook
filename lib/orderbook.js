const {Disposable, CompositeDisposable, Emitter, Orderbook} = require('via');
const _ = require('underscore-plus');
const ViaTable = require('via-table');
const BaseURI = 'via://orderbook';
const etch = require('etch');
const $ = etch.dom;

const AGGREGATION_LOWER_BOUND = 0.1;
const AGGREGATION_UPPER_BOUND = 100000000;

module.exports = class OrderbookView {
    static deserialize(params){
        return new OrderbookView(params);
    }

    serialize(){
        return {
            uri: this.uri
        };
    }

    constructor(params = {}){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.uri = params.uri;
        this.omnibar = params.omnibar;
        this.width = 0;
        this.height = 0;
        this.orderbook = null;
        this.precision = 2;
        this.aggregation = 100;
        this.count = 50;
        this.bids = [];
        this.asks = [];
        this.market = null;

        this.columns = [
            {
                element: row => $.div({classList: 'td scale'},
                    $.div({classList: 'scale-bar', style: `width: ${row.size / row.total * 100}%;`})
                )
            },
            {
                element: row => {
                    let head = row.size.toFixed(8).replace(/0+$/g, '');
                    let tail = '00000000';

                    if(head.slice(-1) === '.'){
                        head += '0';
                    }

                    return $.div({classList: 'td size'}, $.span({}, head), tail.slice(head.split('.')[1].length));
                },
                classes: 'size',
                align: 'right'
            },
            {
                accessor: d => d.price.toFixed(this.market ? this.market.precision.price : 2),
                classes: 'price',
                align: 'right'
            }
        ];

        etch.initialize(this);
        // this.element.tabIndex = -1;

        this.changeMarket(via.markets.findByIdentifier(this.uri.slice(BaseURI.length + 1)));

        this.disposables.add(via.commands.add(this.element, {
            'orderbook:change-market': this.change.bind(this),
            'orderbook:center': this.center.bind(this),
            'orderbook:increase-aggregation': this.increaseAggregation.bind(this),
            'orderbook:decrease-aggregation': this.decreaseAggregation.bind(this),
            'core:move-up': () => this.translate(-50),
            'core:move-down': () => this.translate(50)
        }));

        this.resizeObserver = new ResizeObserver(this.resize.bind(this));
        this.resizeObserver.observe(this.element);

        this.draw();
    }

    center(){
        const scroll = this.refs.table.scrollHeight;
        const client = this.refs.table.clientHeight;

        this.refs.table.scrollTop = (scroll - client) / 2;
        this.emitter.emit('did-center');
    }

    translate(distance){
        this.refs.table.scrollTop += distance;
        this.emitter.emit('did-translate');
    }

    resize(){
        this.width = this.element.clientWidth;
        this.height = this.element.clientHeight;
        this.emitter.emit('did-resize', {width: this.width, height: this.height});
    }

    render(){
        return $.div({classList: 'orderbook', tabIndex: -1},
            $.div({classList: 'orderbook-tools toolbar'},
                $.div({classList: 'market toolbar-button', onClick: this.change.bind(this)},
                    this.market ? this.market.title() : 'Select Market'
                ),
                $.div({classList: 'toolbar-spacer'}),
                $.div({classList: 'aggregation-title'}, 'Grouping'),
                $.div({classList: 'aggregation-value'},
                    (this.aggregation <= 1) ? (1 / this.aggregation).toFixed(2) : (1 / this.aggregation).toFixed(Math.max(this.aggregation.toString().length - 1, 2))
                ),
                $.div({classList: 'toolbar-button change-aggregation minus', onMouseDown: this.decreaseAggregation}),
                $.div({classList: 'toolbar-button change-aggregation plus', onMouseDown: this.increaseAggregation})
            ),
            $.div({classList: 'orderbook-table', ref: 'table'},
                $(ViaTable, {columns: this.columns, data: this.asks, classes: ['asks']}),
                $.div({classList: 'spread'},
                    $.div({classList: 'currency'}, this.market ? `${this.market.quote} Spread` : 'N/A'),
                    $.div({}),
                    $.div({classList: 'value'}, this.orderbook ? this.orderbook.spread().toFixed(this.precision) : '00.00')
                ),
                $(ViaTable, {columns: this.columns, data: this.bids, classes: ['bids']})
            )
        );
    }

    update(){}

    draw(){
        let bids = [];
        let asks = [];
        let item, last;

        if(!this.market){
            this.bids = [];
            this.asks = [];
            etch.update(this);
            return;
        }

        let it = this.orderbook.iterator('buy');

        while(bids.length < this.count && (item = it.prev())){
            let price = Math.floor(item.price * this.aggregation) / this.aggregation;

            if(last && last.price === price){
                last.size = last.size + item.size;
            }else{
                last = {price, size: item.size};
                bids.push(last);
            }
        }

        it = this.orderbook.iterator('sell');
        last = null;

        while(asks.length < this.count && (item = it.next())){
            let price = Math.ceil(item.price * this.aggregation) / this.aggregation;

            if(last && last.price === price){
                last.size = last.size + item.size;
            }else{
                last = {price, size: item.size};
                asks.push(last);
            }
        }

        const bidSizes = bids.map(b => b.size);
        const askSizes = asks.map(a => a.size);

        let totalBids = bidSizes.reduce((a, b) => a + b, 0);
        let totalAsks = askSizes.reduce((a, b) => a + b, 0);

        const maxBid = Math.max(...bidSizes);
        const maxAsk = Math.max(...askSizes);

        let total = totalBids + totalAsks;

        total *= Math.max(maxBid / total, maxAsk / total, .5);

        bids.forEach(bid => bid.total = total);
        asks.forEach(ask => ask.total = total);

        this.bids = bids;
        this.asks = asks.reverse();
        etch.update(this);
    }

    consumeOmnibar(omnibar){
        this.omnibar = omnibar;
    }

    change(){
        if(!this.omnibar) return;

        this.omnibar.search({
            name: 'Change Orderbook Market',
            placeholder: 'Search For a Market to Display...',
            didConfirmSelection: this.changeMarket.bind(this),
            maxResultsPerCategory: 30,
            items: via.markets.all()
        });
    }

    destroy(){
        if(this.orderbook){
            this.orderbook.destroy();
        }

        this.emitter.emit('did-destroy');
        this.disposables.dispose();
        this.emitter.dispose();
        this.resizeObserver.disconnect();
    }

    getURI(){
        return this.uri;
    }

    getTitle(){
        return this.market ? `Order Book, ${this.market.name}` : 'Order Book';
    }

    changeMarket(market){
        if(!market || this.market === market) return;

        if(this.orderbook){
            this.orderbook.destroy();
            this.orderbook = null;
        }

        this.market = market;
        this.bids = [];
        this.asks = [];

        if(this.market.exchange.hasObserveOrderBook){
            this.orderbook = this.market.orderbook();
            this.orderbook.onDidUpdate(this.draw.bind(this));
        }else{
            //TODO Indicate that the orderbook is unsupported
        }

        this.precision = this.market.precision.price;
        this.changeAggregation(Math.pow(10, this.market.precision.price - 1));

        etch.update(this);
        this.center();
        this.emitter.emit('did-change-market', market);
        this.emitter.emit('did-change-title');
    }

    increaseAggregation(){
        this.changeAggregation(this.aggregation / 10);
    }

    decreaseAggregation(){
        this.changeAggregation(this.aggregation * 10);
    }

    changeAggregation(aggregation){
        aggregation = Math.min(Math.max(aggregation, AGGREGATION_LOWER_BOUND), AGGREGATION_UPPER_BOUND);

        if(this.aggregation !== aggregation){
            this.aggregation = aggregation;
            etch.update(this);
            this.emitter.emit('did-change-aggregation', aggregation);
        }
    }

    onDidChangeAggregation(callback){
        return this.emitter.on('did-change-aggregation', callback);
    }

    onDidChangeData(callback){
        return this.emitter.on('did-change-data', callback);
    }

    onDidChangeMarket(callback){
        return this.emitter.on('did-change-market', callback);
    }

    onDidChangeTitle(callback){
        return this.emitter.on('did-change-title', callback);
    }

    onDidDestroy(callback){
        return this.emitter.on('did-destroy', callback);
    }

    onDidResize(callback){
        return this.emitter.on('did-resize', callback);
    }

    onDidDraw(callback){
        return this.emitter.on('did-draw', callback);
    }

    onDidCenter(callback){
        return this.emitter.on('did-center', callback);
    }

    onDidTranslate(callback){
        return this.emitter.on('did-translate', callback);
    }
}
