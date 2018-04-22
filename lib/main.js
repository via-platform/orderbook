const {CompositeDisposable, Disposable, Emitter} = require('via');
const base = 'via://orderbook';

const Orderbook = require('./orderbook');

const InterfaceConfiguration = {
    name: 'Orderbook',
    description: 'A live orderbook containing the bids and offers for a given market.',
    command: 'orderbook:create-orderbook',
    uri: base
};

class OrderbookPackage {
    constructor(){
        this.books = [];
    }

    activate(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();

        this.disposables.add(via.commands.add('via-workspace, .symbol-explorer .market', 'orderbook:create-orderbook', this.create.bind(this)));

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri === base || uri.startsWith(base + '/')){
                const orderbook = new Orderbook({uri, omnibar: this.omnibar});

                this.books.push(orderbook);
                this.emitter.emit('did-create-orderbook', orderbook);

                return orderbook;
            }
        }, InterfaceConfiguration));
    }

    deserialize(state){
        const orderbook = Orderbook.deserialize(state);
        this.books.push(orderbook);
        return orderbook;
    }

    create(e){
        e.stopPropagation();

        if(e.currentTarget.classList.contains('market')){
            const market = e.currentTarget.getMarket();
            via.workspace.open(`${base}/${market.exchange.id}/${market.symbol}`, {});
        }else{
            via.workspace.open(base);
        }
    }

    consumeActionBar(actionBar){
        this.omnibar = actionBar.omnibar;

        for(const book of this.books){
            book.consumeOmnibar(this.omnibar);
        }
    }

    deactivate(){
        this.disposables.dispose();
        this.disposables = null;
    }
}

module.exports = new OrderbookPackage();
