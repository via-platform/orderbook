const {Disposable, CompositeDisposable, Emitter} = require('via');
const _ = require('underscore-plus');
const ViaTable = require('via-table');
const BaseURI = 'via://orderbook';
const RBTree = require('bintrees').RBTree;
const num = require('num-plus');
const etch = require('etch');
const $ = etch.dom;

const table = {
    headers: false,
    columns: [
        {
            element: () => $.div({classList: 'td'}, '-'),
            classes: 'scale'
        },
        {
            element: row => {
                let head = row.size.toString();
                let tail = '00000000';

                if(head.indexOf('.') === -1){
                    return $.div({classList: 'td size'}, $.span({}, head + '.0'), tail.slice(1));
                }else{
                    return $.div({classList: 'td size'}, $.span({}, head), tail.slice(head.split('.')[1].length));
                }
            },
            classes: 'size',
            align: 'right'
        },
        {
            accessor: d => d.price.toString(),
            classes: 'price',
            align: 'right'
        },
        {
            accessor: d => '-',
            classes: 'me',
            align: 'right'
        }
    ]
};

module.exports = class Orderbook {
    static deserialize(params){
        return new Orderbook(params);
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
        this.width = 0;
        this.height = 0;
        this.book = null;
        this.precision = 2;
        this.aggregation = 2;
        this.count = 50;

        this.symbol = via.symbols.findByIdentifier(this.getURI().slice(BaseURI.length + 1));
        this.emitter.emit('did-change-symbol', this.symbol);


        this.book = this.symbol.orderbook(2);
        this.disposables.add(this.book.subscribe(this.draw.bind(this)));

        // this.basis = d3.scaleTime().domain([new Date(Date.now() - 864e5), new Date()]);

        etch.initialize(this);

        this.resizeObserver = new ResizeObserver(this.resize.bind(this));
        this.resizeObserver.observe(this.element);

        this.draw();
    }

    resize(){
        this.width = this.element.clientWidth;
        this.height = this.element.clientHeight;
        //
        // this.basis.range([0, this.width - AXIS_WIDTH]);
        // this.scale.range([0, this.width - AXIS_WIDTH]);
        //
        // this.updateBandwidth();
        //
        // this.emitter.emit('did-resize', {width: this.width, height: this.height});
    }

    render(){
        let base = this.symbol.name.split('-').pop();

        return $.div({classList: 'orderbook table'},
            $.div({classList: 'thead'},
                $.div({classList: 'th'}),
                $.div({classList: 'th'}, 'Market Size'),
                $.div({classList: 'th'}, `Price (${base})`),
                $.div({classList: 'th'}, 'My Size')
            ),
            $.div({classList: 'tbody'},
                $(ViaTable, {columns: table.columns, data: this.asks, classes: ['asks']}),
                $.div({classList: 'spread'},
                    $.div({classList: 'currency'}, `${base} Spread`),
                    $.div({classList: 'value', ref: ''}, this.book.spread().floor(this.aggregation).toString())
                ),
                $(ViaTable, {columns: table.columns, data: this.bids, classes: ['bids']})
            ),
            $.div({classList: 'thead'},
                $.div({classList: 'th'}, 'Aggregation'),
                $.div({classList: 'th'}, num(1).div(Math.pow(10, this.aggregation)).toString())
            )
        );
    }

    update(){}

    draw(){
        // console.log('update')
        let bids = [];
        let asks = [];
        let item, last;

        let it = this.book.iterator('buy');

        while(bids.length < this.count && (item = it.prev())){
            let price = item.price.floor(this.aggregation).set_precision(2);

            if(last && last.price.eq(price)){
                last.size = last.size.add(item.size);
            }else{
                last = {price, size: item.size};
                bids.push(last);
            }
        }

        it = this.book.iterator('sell');
        last = null;

        while(asks.length < this.count && (item = it.next())){
            let price = item.price.ceil(this.aggregation).set_precision(2);

            if(last && last.price.eq(price)){
                last.size = last.size.add(item.size);
            }else{
                last = {price, size: item.size};
                asks.push(last);
            }
        }

        // console.log('updated', this.book.spread().floor(this.aggregation).toString());
        this.bids = bids;
        this.asks = asks.reverse();
        etch.update(this);
        // this.bids.update(bids);
        // this.asks.update(asks);
    }

    destroy(){
        this.disposables.dispose();
        this.emitter.dispose();
        this.resizeObserver.disconnect();
        this.emitter.emit('did-destroy');
    }

    getURI(){
        return this.uri;
    }

    getIdentifier(){
        return this.getURI().slice(BaseURI.length + 1);
    }

    getTitle(){
        return 'Order Book';
    }

    changeSymbol(symbol){
        this.symbol = symbol;
        this.emitter.emit('did-change-symbol', symbol);
    }

    changeAggregation(aggregation){
        this.aggregation = aggregation;
        this.emitter.emit('did-change-aggregation', aggregation);
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
