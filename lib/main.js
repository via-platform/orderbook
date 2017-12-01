const {CompositeDisposable, Disposable, Emitter} = require('via');
const BaseURI = 'via://orderbook';

const Orderbook = require('./orderbook');

class OrderbookPackage {
    activate(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.books = [];

        via.commands.add('via-workspace', {
            'orderbook:default': () => via.workspace.open(BaseURI + '/GDAX:BTC-USD')
        });

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri.startsWith(BaseURI)){
                const orderbook = new Orderbook({uri});

                this.books.push(orderbook);
                this.emitter.emit('did-create-orderbook', orderbook);

                return orderbook;
            }
        }));
    }

    deactivate(){
        this.disposables.dispose();
        this.disposables = null;
    }
}

module.exports = new OrderbookPackage();
