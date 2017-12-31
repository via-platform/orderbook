const {CompositeDisposable, Disposable, Emitter} = require('via');
const BaseURI = 'via://orderbook';

const Orderbook = require('./orderbook');

const InterfaceConfiguration = {
    name: 'Orderbook',
    description: 'A live orderbook containing the bids and offers for a given symbol.',
    command: 'orderbook:create-orderbook',
    uri: BaseURI
};

class OrderbookPackage {
    activate(){
        this.disposables = new CompositeDisposable();
        this.emitter = new Emitter();
        this.books = [];

        this.disposables.add(via.commands.add('via-workspace', {
            'orderbook:create-orderbook': () => via.workspace.open(BaseURI + '/GDAX:BTC-USD')
        }));

        this.disposables.add(via.workspace.addOpener((uri, options) => {
            if(uri.startsWith(BaseURI)){
                const orderbook = new Orderbook({uri, omnibar: this.omnibar});

                this.books.push(orderbook);
                this.emitter.emit('did-create-orderbook', orderbook);

                return orderbook;
            }
        }, InterfaceConfiguration));
    }

    consumeActionBar(actionBar){
        this.omnibar = actionBar.omnibar;

        for(let chart of this.charts){
            chart.consumeActionBar(actionBar);
        }
    }

    deactivate(){
        this.disposables.dispose();
        this.disposables = null;
    }
}

module.exports = new OrderbookPackage();
