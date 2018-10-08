const {Disposable, CompositeDisposable, Emitter} = require('via');
const _ = require('underscore-plus');
const ViaTable = require('via-table');
const base = 'via://orderbook';
const etch = require('etch');
const $ = etch.dom;

const AGGREGATION_LOWER_BOUND = 0.1;
const AGGREGATION_UPPER_BOUND = 100000000;

module.exports = class Orderbook {
    static deserialize(params, state){
        return new Orderbook(params, state);
    }

    serialize(){
        return {
            deserializer: 'Orderbook',
            uri: this.getURI(),
            aggregation: this.aggregation,
            count: this.count,
            group: this.group ? this.group.color : ''
        };
    }

    constructor({manager, omnibar}, state = {}){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.uri = state.uri;
        this.omnibar = omnibar;
        this.width = 0;
        this.height = 0;
        this.aggregation = state.aggregation || 100;
        this.count = state.count || 50;
        this.bids = [];
        this.asks = [];
        this.market = null;

        this.properties = this.properties.bind(this);
        this.mouseover = this.mouseover.bind(this);
        this.mouseout = this.mouseout.bind(this);

        this.columns = [
            {
                name: 'scale',
                title: 'Relative Size',
                default: true,
                element: row => $.div({classList: 'td scale'},
                    $.div({classList: 'scale-bar', style: `width: ${row.size / row.total * 100}%;`})
                )
            },
            {
                name: 'size',
                title: 'Size',
                default: true,
                align: 'right',
                element: row => {
                    let head = row.size.toFixed(8).replace(/0+$/g, '');
                    let tail = '00000000';

                    if(head.slice(-1) === '.'){
                        head += '0';
                    }

                    return $.div({classList: 'td size'}, $.span({}, head), tail.slice(head.split('.')[1].length));
                }
            },
            {
                name: 'price',
                title: 'Price',
                classes: 'price',
                align: 'right',
                default: true,
                accessor: d => d.price.toFixed(this.market ? this.market.precision.price : 2)
            }
        ];

        etch.initialize(this);

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

        this.initialize(state);
    }

    async initialize(state){
        await via.markets.initialize();

        const [method, id] = this.uri.slice(base.length + 1).split('/');

        if(method === 'market'){
            const market = via.markets.uri(id);
            this.changeMarket(market);
        }

        this.changeGroup(state.group ? via.workspace.groups.get(state.group) : null);
        this.initialized = true;
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

    properties(item){
        return {
            // onMouseOver: () => this.mouseover(item),
            // onMouseOut: () => this.mouseout(item)
        };
    }

    render(){
        return $.div({classList: 'orderbook', tabIndex: -1},
            $.div({classList: 'orderbook-tools toolbar'},
                $.div({classList: 'market toolbar-button', onClick: this.change.bind(this)},
                    this.market ? this.market.title : 'Select Market'
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
                $(ViaTable, {columns: this.columns, data: this.asks, classes: 'asks', properties: this.properties}),
                $.div({classList: 'spread'},
                    $.div({classList: 'currency'}, this.market ? `${this.market.quote} Spread` : 'N/A'),
                    $.div({}),
                    $.div({classList: 'value'}, this.market ? this.market.orderbook.spread().toFixed(this.market.precision.price) : '00.00')
                ),
                $(ViaTable, {columns: this.columns, data: this.bids, classes: 'bids', properties: this.properties})
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

        let it = this.market.orderbook.iterator('buy');

        while(bids.length < this.count && (item = it.prev())){
            let price = Math.floor(item.price * this.aggregation) / this.aggregation;

            if(last && last.price === price){
                last.size = last.size + item.size;
            }else{
                last = {price, size: item.size};
                bids.push(last);
            }
        }

        it = this.market.orderbook.iterator('sell');
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
            didConfirmSelection: selection => this.changeMarket(selection.market),
            maxResultsPerCategory: 60,
            items: via.markets.tradeable().map(m => ({name: m.title, description: m.description, market: m}))
        });
    }

    destroy(){
        if(this.groupDisposables){
            this.groupDisposables.dispose();
        }

        if(this.subscription){
            this.subscription.dispose();
        }

        this.emitter.emit('did-destroy');
        this.disposables.dispose();
        this.emitter.dispose();
        this.resizeObserver.disconnect();
    }

    getURI(){
        return this.market ? `${base}/market/${this.market.uri()}` : base;
    }

    getTitle(){
        return this.market ? `Order Book, ${this.market.title}` : 'Order Book';
    }

    changeMarket(market){
        if(!market || this.market === market) return;

        if(this.subscription){
            this.subscription.dispose();
        }

        this.market = market;
        this.bids = [];
        this.asks = [];

        this.subscription = this.market.orderbook.subscribe(this.draw.bind(this));

        this.changeAggregation(Math.pow(10, this.market.precision.price - 1));

        etch.update(this);
        this.draw();
        this.center();
        this.emitter.emit('did-change-market', market);
        this.emitter.emit('did-change-title');

        if(this.group){
            this.group.market = market;
        }
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
            this.draw();
            this.emitter.emit('did-change-aggregation', aggregation);
        }
    }

    changeGroup(group){
        if(this.group === group){
            return;
        }

        this.group = group;

        if(this.groupDisposables){
            this.groupDisposables.dispose();
            this.groupDisposables = null;
        }

        if(this.group){
            this.groupDisposables = new CompositeDisposable(
                this.group.onDidChangeMarket(this.changeMarket.bind(this))
            );

            if(this.group.market){
                this.changeMarket(this.group.market);
            }else{
                this.group.market = this.market;
            }
        }

        this.emitter.emit('did-change-group', this.group);
    }

    mouseover(item){
        if(this.group){
            this.group.hover = item.price;
        }
    }

    mouseout(){
        if(this.group){
            this.group.hover = null;
        }
    }

    getMarket(){
        return this.market;
    }

    onDidChangeGroup(callback){
        return this.emitter.on('did-change-group', callback);
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
