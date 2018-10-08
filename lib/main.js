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
    initialize(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.books = [];

        this.disposables.add(via.commands.add('via-workspace, .symbol-explorer .market, .watchlist .market', 'orderbook:create-orderbook', this.create.bind(this)));

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri === base || uri.startsWith(base + '/')){
                const orderbook = new Orderbook({manager: this, omnibar: this.omnibar}, {uri});

                this.books.push(orderbook);
                this.emitter.emit('did-create-orderbook', orderbook);

                return orderbook;
            }
        }, InterfaceConfiguration));
    }

    deserialize(state){
        const orderbook = Orderbook.deserialize({manager: this, omnibar: this.omnibar}, state);
        this.books.push(orderbook);
        return orderbook;
    }

    create(e){
        e.stopPropagation();

        if(e.currentTarget.classList.contains('market')){
            via.workspace.open(`${base}/market/${e.currentTarget.market.uri()}`, {});
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
