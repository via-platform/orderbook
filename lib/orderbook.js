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
        this.symbol = null;

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
                accessor: d => d.price.toFixed(this.symbol ? this.symbol.aggregation : 2),
                classes: 'price',
                align: 'right'
            }
        ];

        etch.initialize(this);
        this.changeSymbol(via.symbols.findByIdentifier(this.getURI().slice(BaseURI.length + 1)));

        this.resizeObserver = new ResizeObserver(this.resize.bind(this));
        this.resizeObserver.observe(this.element);

        this.draw();
    }

    resize(){
        this.width = this.element.clientWidth;
        this.height = this.element.clientHeight;
        this.emitter.emit('did-resize', {width: this.width, height: this.height});
    }

    render(){
        let base = this.symbol && this.symbol.name.split('-').pop();

        return $.div({classList: 'orderbook table'},
            $.div({classList: 'orderbook-tools toolbar'},
                $.div({classList: 'orderbook-tools-left'},
                    $.div({classList: 'symbol btn btn-subtle', onClick: this.change.bind(this)}, this.format(this.symbol))
                ),
                $.div({classList: 'orderbook-tools-spacer'}),
                $.div({classList: 'orderbook-tools-right'})
                // $.div({classList: 'th symbol', onClick: this.change}, this.symbol ? this.symbol.identifier : 'Change Symbol'),
                // $.div({classList: 'th align-right'}, 'Market Size'),
                // $.div({classList: 'th align-right'}, `Price (${base})`)
            ),
            $.div({classList: 'tbody'},
                $(ViaTable, {columns: this.columns, data: this.asks, classes: ['asks']}),
                $.div({classList: 'spread'},
                    $.div({classList: 'currency'}, this.symbol ? `${base} Spread` : 'N/A'),
                    $.div({}),
                    $.div({classList: 'value', ref: ''}, this.orderbook ? this.orderbook.spread().toFixed(this.precision) : '00.00')
                ),
                $(ViaTable, {columns: this.columns, data: this.bids, classes: ['bids']})
            ),
            $.div({classList: 'orderbook-tools bottom toolbar'},
                $.div({classList: 'orderbook-tools-left'},
                    $.div({classList: 'aggregation-title'}, 'Aggregation')
                ),
                $.div({classList: 'orderbook-tools-spacer'}),
                $.div({classList: 'orderbook-tools-right'},
                    $.div({classList: 'btn btn-subtle change-aggregation minus', onMouseDown: this.decreaseAggregation}),
                    $.div({classList: 'aggregation-value'},
                        (this.aggregation <= 1) ? (1 / this.aggregation) : (1 / this.aggregation).toFixed(this.aggregation.toString().length - 1)
                    ),
                    $.div({classList: 'btn btn-subtle change-aggregation plus', onMouseDown: this.increaseAggregation})
                )
            )
        );
    }

    format(symbol){
        if(!symbol){
            return 'No Symbol';
        }

        return symbol.identifier;
    }

    update(){}

    draw(){
        let bids = [];
        let asks = [];
        let item, last;

        if(!this.symbol){
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

        totalBids *= Math.max(maxBid / totalBids, .5);
        totalAsks *= Math.max(maxAsk / totalAsks, .5);

        bids.forEach(bid => bid.total = totalBids);
        asks.forEach(ask => ask.total = totalAsks);

        this.bids = bids;
        this.asks = asks.reverse();
        etch.update(this);
    }

    consumeOmnibar(omnibar){
        this.omnibar = omnibar;
    }

    change(){
        if(this.omnibar){
            this.omnibar.search({
                name: 'Change Orderbook Symbol',
                placeholder: 'Enter a Symbol to Display...',
                didConfirmSelection: selection => this.changeSymbol(selection.symbol),
                maxResultsPerCategory: 30,
                items: via.symbols.getSymbols()
                    .map(symbol => {
                        return {
                            symbol: symbol,
                            name: symbol.identifier,
                            description: symbol.description
                        };
                    })
            });
        }else{
            console.error('Could not find omnibar.');
        }
    }

    destroy(){
        if(this.orderbook){
            this.orderbook.destroy();
        }

        if(this.orderbookDisposable){
            this.orderbookDisposable.dispose();
        }

        this.emitter.emit('did-destroy');
        this.disposables.dispose();
        this.emitter.dispose();
        this.resizeObserver.disconnect();
    }

    getURI(){
        return this.uri;
    }

    getIdentifier(){
        return this.uri ? this.uri.slice(BaseURI.length + 1) : undefined;
    }

    getTitle(){
        return 'Order Book';
    }

    changeSymbol(symbol){
        if(this.symbol !== symbol){
            this.symbol = symbol;
            this.bids = [];
            this.asks = [];

            if(this.orderbook){
                this.orderbook.destroy();
            }

            if(this.orderbookDisposable){
                this.orderbookDisposable.dispose();
            }

            this.orderbook = new Orderbook(this.symbol);
            this.orderbookDisposable = this.orderbook.onDidUpdate(this.draw.bind(this));
            this.precision = this.symbol.aggregation;
            this.changeAggregation(Math.pow(10, this.symbol.aggregation - 1));

            etch.update(this);
            this.emitter.emit('did-change-symbol', symbol);
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

    onDidChangeSymbol(callback){
        return this.emitter.on('did-change-symbol', callback);
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
}
