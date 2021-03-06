'use strict';

var $ = require('preconditions').singleton();
var _ = require('lodash');
var async = require('async');
var log = require('npmlog');
log.debug = log.verbose;

var BlockchainExplorer = require('./blockchainexplorer');
var Storage = require('./storage');
var MessageBroker = require('./messagebroker');
var Lock = require('./lock');

var Notification = require('./model/notification');

var WalletService = require('./server');
var Common = require('./common');
var Constants = Common.Constants;
var Utils = Common.Utils;

var NodeCache = require('node-cache');

function BlockchainMonitor() {}

BlockchainMonitor.prototype.start = function(opts, cb) {
  opts = opts || {};

  var self = this;
  this.cache = new NodeCache({ stdTTL: 300, checkperiod: 100 });
  this.flushBufferTimeout = opts.flushBufferTimeout || 1000;
  this.flushBufferCount = opts.flushBufferCount || 100;
  this.buffer = [];
  this.thirdpartyBuffer = [];

  async.parallel(
    [
      function(done) {
        self.explorers = {
          btc: {},
          bch: {},
        };

        var coinNetworkPairs = [];
        _.each(_.values(Constants.COINS), function(coin) {
          _.each(_.values(Constants.NETWORKS), function(network) {
            coinNetworkPairs.push({
              coin: coin,
              network: network,
            });
          });
        });
        _.each(coinNetworkPairs, function(pair) {
          var explorer;
          if (opts.blockchainExplorers && opts.blockchainExplorers[pair.coin] && opts.blockchainExplorers[pair.coin][pair.network]) {
            explorer = opts.blockchainExplorers[pair.coin][pair.network];
          } else {
            var config = {};
            if (opts.blockchainExplorerOpts && opts.blockchainExplorerOpts[pair.coin] && opts.blockchainExplorerOpts[pair.coin][pair.network]) {
              config = opts.blockchainExplorerOpts[pair.coin][pair.network];
            } else {
              return;
            }
            explorer = new BlockchainExplorer({
              provider: config.provider,
              coin: pair.coin,
              network: pair.network,
              url: config.url,
              apiPrefix: config.apiPrefix,
              userAgent: WalletService.getServiceVersion(),
            });
          }
          $.checkState(explorer);
          self._initExplorer(pair.coin, pair.network, explorer);
          self.explorers[pair.coin][pair.network] = explorer;
        });
        done();
      },
      function(done) {
        if (opts.storage) {
          self.storage = opts.storage;
          done();
        } else {
          self.storage = new Storage();
          self.storage.connect(
            opts.storageOpts,
            done,
          );
        }
      },
      function(done) {
        self.messageBroker = opts.messageBroker || new MessageBroker(opts.messageBrokerOpts);
        done();
      },
      function(done) {
        self.lock = opts.lock || new Lock(opts.lockOpts);
        done();
      },
    ],
    function(err) {
      if (err) {
        log.error(err);
      }
      return cb(err);
    },
  );
};

BlockchainMonitor.prototype._initExplorer = function(coin, network, explorer) {
  var self = this;

  var socket = explorer.initSocket();

  socket.on('connect', function() {
    log.info('Connected to ' + explorer.getConnectionInfo());
    socket.emit('subscribe', 'inv');
  });
  socket.on('connect_error', function(err) {
    log.error('Error connecting to ' + explorer.getConnectionInfo(), err);
  });
  socket.on('error', function(err) {
    log.error('Error ' + explorer.getConnectionInfo(), err);
  });
  socket.on('disconnect', function(err) {
    log.error('Disconnected ' + explorer.getConnectionInfo(), err);
  });
  socket.on('tx', _.bind(self._handleIncomingTx, self, coin, network));
  socket.on('block', _.bind(self._handleNewBlock, self, coin, network));
};

BlockchainMonitor.prototype._handleThirdPartyBroadcasts = function(data) {
  var self = this;
  if (!data || !data.txid) return;

  this.thirdpartyBuffer.push(data.txid);
  if (this.thirdpartyBuffer.length < 50) {
    return;
  }

  var localBuffer = this.thirdpartyBuffer.splice(0, 50);

  self.storage.fetchTxByHash(localBuffer, function(err, txps) {
    if (err) {
      log.error(`Could not fetch tx from the db, count:${localBuffer.length}, error:${err}`, err);
      return;
    }
    _.each(txps, function(txp) {
      if (!txp || txp.status != 'accepted') return;

      var walletId = txp.walletId;

      log.info('Detected broadcast ' + data.txid + ' of an accepted txp [' + txp.id + '] for wallet ' + walletId + ' [' + txp.amount + 'sat ]');
      return setTimeout(processIt.bind(self, txp), 20 * 1000);

      function processIt(txp) {
        log.info('Processing accepted txp [' + txp.id + '] for wallet ' + walletId + ' [' + txp.amount + 'sat ]');

        txp.setBroadcasted();

        self.storage.softResetTxHistoryCache(walletId, function() {
          self.storage.storeTx(self.walletId, txp, function(err) {
            if (err) log.error('Could not save TX');

            var args = {
              txProposalId: txp.id,
              txid: data.txid,
              amount: txp.getTotalAmount(),
            };

            var notification = Notification.create({
              type: 'NewOutgoingTxByThirdParty',
              data: args,
              walletId: walletId,
            });
            self._storeAndBroadcastNotification(notification);
          });
        });
      }
    });
  });
};

BlockchainMonitor.prototype._handleIncomingPayments = function(coin, network, data) {
  var self = this;
  if (!data || !data.vout) return;

  var outs = _.compact(
    _.map(data.vout, function(v) {
      var addr = _.keys(v)[0];
      var amount = +v[addr];

      // This is because a bug on insight, that always return no copay addr
      if (coin == 'bch' && Utils.getAddressCoin(addr) != 'bch') {
        addr = Utils.translateAddress(addr, coin);
      }

      return {
        address: addr,
        amount: amount,
        txid: data.txid,
        coin,
      };
    }),
  );
  if (_.isEmpty(outs)) return;

  this.buffer = this.buffer.concat(outs);
  // remove duplicates
  this.buffer = _.uniq(this.buffer, function(o) {
    return o.txid + o.address + o.coin;
  });
  if (this.buffer.length < this.flushBufferCount) {
    if (this.flushBufferTimeoutRef) {
      clearTimeout(this.flushBufferTimeoutRef);
      this.flushBufferTimeoutRef = null;
    }

    this.flushBufferTimeoutRef = setTimeout(function() {
      try {
        self.flushBufferTimeoutRef = null;
        self._handleIncomingPaymentsBuffer();
      } catch (e) {}
    }, this.flushBufferTimeout);

    return;
  }

  this._handleIncomingPaymentsBuffer();
};

BlockchainMonitor.prototype._handleIncomingPaymentsBuffer = function() {
  if (!this.buffer.length) {
    return;
  }
  var self = this;
  var localBuffer = this.buffer.splice(0, this.flushBufferCount);

  this.storage.fetchAddressesByInfo(localBuffer, function(err, dbAddresses) {
    handleAddresses(err, dbAddresses, localBuffer);
  });

  function handleAddresses(err, dbAddresses, buffer) {
    if (err) {
      log.error(`Could not fetch addresses from the db, count:${buffer.length}, error: ${JSON.stringify(err)}`, err);
      if (err.message.indexOf('Request rate is large') >= 0) {
        log.info('retrying');
        setTimeout(function() {
          self.storage.fetchAddressesByInfo(buffer, function(err, dbAddresses) {
            handleAddresses(err, dbAddresses, buffer);
          });
        }, 100);
      }
      return;
    }

    if (!dbAddresses) {
      return;
    }

    var walletIds = _.compact(_.uniq(_.map(dbAddresses, 'walletId')));
    var fromTs = Date.now() - 24 * 3600 * 1000;
    var notificationsPerWalletCollection = {};
    self.storage.fetchNotifications(walletIds, null, fromTs, function(err, notifications) {
      if (err) {
        log.error(`Could not fetch notifications from the db, count:${walletIds.length}, error: ${JSON.stringify(err)}`);
        return;
      }
      _.forEach(notifications, function(n) {
        if (!notificationsPerWalletCollection[n.walletId]) {
          notificationsPerWalletCollection[n.walletId] = [];
        }
        notificationsPerWalletCollection[n.walletId].push(n);
      });
      runAsync(dbAddresses, buffer);
    });

    function runAsync(dbAddresses, buffer) {
      async.each(
        dbAddresses,
        function(dbAddr, next) {
          if (!dbAddr || dbAddr.isChange || !dbAddr.address) return next();

          var allTxForAddress = _.filter(buffer, { address: dbAddr.address });
          // in case the are more than one transaction for an address we need to sum the amount
          var totalAmount = _.map(allTxForAddress, 'amount').reduce(function(accumulated, current) {
            return accumulated + current;
          });

          var walletId = dbAddr.walletId;
          log.info('Incoming tx for wallet ' + walletId + ' [' + totalAmount + 'sat -> ' + dbAddr.address + ']');

          var walletNotifications = notificationsPerWalletCollection[walletId] || [];

          var newNotifications = _.map(allTxForAddress, function(txForAddress) {
            var alreadyNotified = _.any(walletNotifications, function(n) {
              return n.type == 'NewIncomingTx' && n.data && n.data.txid == txForAddress.txid && n.data.address == txForAddress.address;
            });
            if (alreadyNotified) {
              log.info('The incoming tx ' + txForAddress.txid + ' for address ' + txForAddress.address + 'was already notified');
              return;
            }
            var notification = Notification.create({
              type: 'NewIncomingTx',
              data: {
                txid: txForAddress.txid,
                address: txForAddress.address,
                amount: txForAddress.amount,
              },
              walletId: walletId,
            });
            walletNotifications.push(notification);
            return notification;
          });

          self.storage.softResetTxHistoryCache(walletId, function() {
            self._updateAddressesWithBalance(dbAddr, function() {
              _.forEach(_.compact(newNotifications), function(notification) {
                self._storeAndBroadcastNotification(notification);
              });
              next();
            });
          });
        },
        function(err) {
          return;
        },
      );
    }
  }
};

BlockchainMonitor.prototype._updateAddressesWithBalance = function(address, cb) {
  var self = this;

  self.storage.fetchAddressesWithBalance(address.walletId, function(err, result) {
    if (err) {
      log.warn('Could not update wallet cache', err);
      return cb(err);
    }
    var addresses = _.map(result, 'address');

    if (_.indexOf(addresses, address.address) >= 0) {
      return cb();
    }

    addresses.push(address.address);
    log.info('Activating address ' + address.address);
    self.storage.storeAddressesWithBalance(address.walletId, addresses, function(err) {
      if (err) {
        log.warn('Could not update wallet cache', err);
      }
      return cb(err);
    });
  });
};

BlockchainMonitor.prototype._handleIncomingTx = function(coin, network, data) {
  //this._handleThirdPartyBroadcasts(data);
  this._handleIncomingPayments(coin, network, data);
};

BlockchainMonitor.prototype._notifyNewBlock = function(coin, network, hash) {
  var self = this;

  log.info('New ' + network + ' block: ' + hash);
  var notification = Notification.create({
    type: 'NewBlock',
    walletId: network, // use network name as wallet id for global notifications
    data: {
      hash: hash,
      coin: coin,
      network: network,
    },
  });

  self.storage.softResetAllTxHistoryCache(function() {
    self._storeAndBroadcastNotification(notification, function(err) {
      return;
    });
  });
};

BlockchainMonitor.prototype._handleTxConfirmations = function(coin, network, hash) {
  var self = this;

  function processTriggeredSubs(subs, cb) {
    async.each(subs, function(sub) {
      log.info('New tx confirmation ' + sub.txid);
      sub.isActive = false;
      self.storage.storeTxConfirmationSub(sub, function(err) {
        if (err) return cb(err);

        var notification = Notification.create({
          type: 'TxConfirmation',
          walletId: sub.walletId,
          creatorId: sub.copayerId,
          data: {
            txid: sub.txid,
            coin: coin,
            network: network,
            // TODO: amount
          },
        });
        self._storeAndBroadcastNotification(notification, cb);
      });
    });
  }

  var explorer = self.explorers[coin][network];
  if (!explorer) return;

  explorer.getTxidsInBlock(hash, function(err, txids) {
    if (err) {
      log.error('Could not fetch txids from block ' + hash, err);
      return;
    }

    self.storage.fetchActiveTxConfirmationSubs(null, function(err, subs) {
      if (err) return;
      if (_.isEmpty(subs)) return;
      var indexedSubs = _.indexBy(subs, 'txid');
      var triggered = [];
      _.each(txids, function(txid) {
        if (indexedSubs[txid]) triggered.push(indexedSubs[txid]);
      });
      processTriggeredSubs(triggered, function(err) {
        if (err) {
          log.error('Could not process tx confirmations', err);
        }
        return;
      });
    });
  });
};

BlockchainMonitor.prototype._handleNewBlock = function(coin, network, hash) {
  if (!this._shouldHandleNewBlock(hash)) {
    return;
  }
  this._notifyNewBlock(coin, network, hash);
  this._handleTxConfirmations(coin, network, hash);
};

BlockchainMonitor.prototype._storeAndBroadcastNotification = function(notification, cb) {
  var self = this;

  self.storage.storeNotification(notification.walletId, notification, function() {
    self.messageBroker.send(notification);
    if (cb) return cb();
  });
};

BlockchainMonitor.prototype._shouldHandleNewBlock = function(cacheKey) {
  var cachedValue = this.cache.get(cacheKey);

  if (cachedValue === undefined) {
    this.cache.set(cacheKey, {});
    log.info(`${cacheKey} Added to cache`);
  } else {
    this.cache.ttl(cacheKey);
    log.info(`${cacheKey} Found in cache`);
    return false;
  }

  return true;
};

module.exports = BlockchainMonitor;
