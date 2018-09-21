'use strict';

var _ = require('lodash');
var async = require('async');
var $ = require('preconditions').singleton();
var log = require('npmlog');
log.debug = log.verbose;
log.disableColor();
var util = require('util');
var Bitcore = require('bitcore-lib');
var mongodb = require('mongodb');
var NodeCache = require('node-cache');

var Model = require('./model');

var collectionName = 'bws';
var dataType = {
  WALLETS: 'wallets',
  TXS: 'txs',
  ADDRESSES: 'addresses',
  NOTIFICATIONS: 'notifications',
  COPAYERS_LOOKUP: 'copayers_lookup',
  PREFERENCES: 'preferences',
  EMAIL_QUEUE: 'email_queue',
  CACHE: 'cache',
  FIAT_RATES: 'fiat_rates',
  TX_NOTES: 'tx_notes',
  SESSIONS: 'sessions',
  PUSH_NOTIFICATION_SUBS: 'push_notification_subs',
  TX_CONFIRMATION_SUBS: 'tx_confirmation_subs',
};

var Storage = function(opts) {
  opts = opts || {};
  this.db = opts.db;
  this.cache = new NodeCache({ stdTTL: 300, checkperiod: 100 });
};

Storage.prototype._createIndexes = function() {
  // this.db.collection(collections.WALLETS).createIndex({
  //   id: 1
  // });
  // this.db.collection(collections.COPAYERS_LOOKUP).createIndex({
  //   copayerId: 1
  // });
  // this.db.collection(collections.COPAYERS_LOOKUP).createIndex({
  //    walletId: 1
  // });
  // this.db.collection(collections.TXS).createIndex({
  //   walletId: 1,
  //   id: 1,
  // });
  // this.db.collection(collections.TXS).createIndex({
  //   walletId: 1,
  //   isPending: 1,
  //   txid: 1,
  // });
  // this.db.collection(collections.TXS).createIndex({
  //   walletId: 1,
  //   createdOn: -1,
  // });
  // this.db.collection(collections.TXS).createIndex({
  //   txid: 1
  // });
  // this.db.collection(collections.NOTIFICATIONS).createIndex({
  //   walletId: 1,
  //   id: 1,
  // });
  // this.db.collection(collections.ADDRESSES).createIndex({
  //   walletId: 1,
  //   createdOn: 1,
  // });
  // this.db.collection(collections.ADDRESSES).createIndex({
  //   address: 1,
  // });
  // this.db.collection(collections.ADDRESSES).createIndex({
  //   walletId: 1,
  //   address: 1,
  // });
  // this.db.collection(collections.EMAIL_QUEUE).createIndex({
  //   id: 1,
  // });
  // this.db.collection(collections.EMAIL_QUEUE).createIndex({
  //   notificationId: 1,
  // });
  // this.db.collection(collections.CACHE).createIndex({
  //   walletId: 1,
  //   type: 1,
  //   key: 1,
  // });
  // this.db.collection(collections.TX_NOTES).createIndex({
  //   walletId: 1,
  //   txid: 1,
  // });
  // this.db.collection(collections.PREFERENCES).createIndex({
  //   walletId: 1
  // });
  // this.db.collection(collections.FIAT_RATES).createIndex({
  //   provider: 1,
  //   code: 1,
  //   ts: 1
  // });
  // this.db.collection(collections.PUSH_NOTIFICATION_SUBS).createIndex({
  //   copayerId: 1,
  // });
  // this.db.collection(collections.TX_CONFIRMATION_SUBS).createIndex({
  //   copayerId: 1,
  //   txid: 1,
  // });
  // this.db.collection(collections.SESSIONS).createIndex({
  //   copayerId: 1
  // });
};

Storage.prototype.connect = function(opts, cb) {
  var self = this;

  var encodePassword = function(connectionString) {
    const matches = /^mongodb:.*:(.*)\@/g.exec(connectionString);
    if (matches === null) {
      return connectionString;
    }
    const encodedPassword = encodeURIComponent(matches[1]);
    return connectionString.replace(matches[1], encodedPassword);
  };

  opts = opts || {};

  if (this.db) return cb();

  var config = opts.mongoDb || {};
  collectionName = config.collectionName || collectionName;
  config.uri = encodePassword(config.uri);
  mongodb.MongoClient.connect(
    config.uri,
    function(err, db) {
      if (err) {
        log.error('Unable to connect to the mongoDB. Check the credentials.');
        log.error(err);
        return cb(err);
      }
      self.db = db.db(config.dbName || 'bws');
      self._createIndexes();
      console.log('Connection established to mongoDB');
      return cb();
    },
  );
};

Storage.prototype.disconnect = function(cb) {
  var self = this;
  this.db.close(true, function(err) {
    if (err) return cb(err);
    self.db = null;
    return cb();
  });
};

Storage.prototype.fetchWallet = function(id, cb) {
  if (!this.db) return cb('not ready');

  this.db.collection(collectionName).findOne(
    {
      id: id,
      dataType: dataType.WALLETS,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      return cb(null, Model.Wallet.fromObj(result));
    },
  );
};

Storage.prototype.storeWallet = function(wallet, cb) {
  this.db.collection(collectionName).update(
    {
      id: wallet.id,
      dataType: dataType.WALLETS,
    },
    { ...wallet.toObject(), dataType: dataType.WALLETS },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.storeWalletAndUpdateCopayersLookup = function(wallet, cb) {
  var self = this;

  var copayerLookups = _.map(wallet.copayers, function(copayer) {
    $.checkState(copayer.requestPubKeys);
    return {
      copayerId: copayer.id,
      walletId: wallet.id,
      requestPubKeys: copayer.requestPubKeys,
      dataType: dataType.COPAYERS_LOOKUP,
    };
  });

  this.db.collection(collectionName).remove(
    {
      walletId: wallet.id,
      dataType: dataType.COPAYERS_LOOKUP,
    },
    {
      w: 1,
    },
    function(err) {
      if (err) return cb(err);
      self.db.collection(collectionName).insert(
        copayerLookups,
        {
          w: 1,
        },
        function(err) {
          if (err) return cb(err);
          return self.storeWallet(wallet, cb);
        },
      );
    },
  );
};

Storage.prototype.fetchCopayerLookup = function(copayerId, cb) {
  this.db.collection(collectionName).findOne(
    {
      copayerId: copayerId,
      dataType: dataType.COPAYERS_LOOKUP,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();

      if (!result.requestPubKeys) {
        result.requestPubKeys = [
          {
            key: result.requestPubKey,
            signature: result.signature,
          },
        ];
      }

      return cb(null, result);
    },
  );
};

// TODO: should be done client-side
Storage.prototype._completeTxData = function(walletId, txs, cb) {
  var self = this;

  var cacheKey = `walletId:${walletId}`;
  var cachedValue = this.cache.get(cacheKey);

  if (cachedValue !== undefined) {
    this.cache.ttl(cacheKey);
    log.info(`${cacheKey} Found in cache`);

    _.each([].concat(txs), function(tx) {
      completeWithWalletData(tx, cachedValue);
    });
    return cb(null, txs);
  }

  self.fetchWallet(walletId, function(err, wallet) {
    if (err) return cb(err);
    self.cache.set(cacheKey, wallet);
    log.info(`${cacheKey} Added to cache`);
    _.each([].concat(txs), function(tx) {
      completeWithWalletData(tx, wallet);
    });
    return cb(null, txs);
  });

  function completeWithWalletData(tx, wallet) {
    tx.derivationStrategy = wallet.derivationStrategy || 'BIP45';
    tx.creatorName = wallet.getCopayer(tx.creatorId).name;
    _.each(tx.actions, function(action) {
      action.copayerName = wallet.getCopayer(action.copayerId).name;
    });

    if (tx.status == 'accepted') tx.raw = tx.getRawTx();
    return tx;
  }
};

// TODO: remove walletId from signature
Storage.prototype.fetchTx = function(walletId, txProposalId, cb) {
  var self = this;
  if (!this.db) return cb();

  this.db.collection(collectionName).findOne(
    {
      id: txProposalId,
      walletId: walletId,
      dataType: dataType.TXS,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      return self._completeTxData(walletId, Model.TxProposal.fromObj(result), cb);
    },
  );
};

/**
 *
 * @param {String|String[]} hash
 */
Storage.prototype.fetchTxByHash = function(hash, cb) {
  var self = this;
  if (!this.db) return cb();
  var query = {
    txid: hash,
    dataType: dataType.TXS,
  };

  if (_.isArray(hash)) {
    query.txid = { $in: hash };
    this.db
      .collection(collectionName)
      .find(query)
      .toArray(function(err, results) {
        if (err) return cb(err);
        if (!results) return cb();
        var txs = _.map(results, function(tx) {
          return self._completeTxData(tx.walletId, Model.TxProposal.fromObj(tx), cb);
        });
        return cb(null, txs);
      });
  } else {
    this.db.collection(collectionName).findOne(query, function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();

      return self._completeTxData(result.walletId, Model.TxProposal.fromObj(result), cb);
    });
  }
};

Storage.prototype.fetchLastTxs = function(walletId, creatorId, limit, cb) {
  var self = this;

  this.db
    .collection(collectionName)
    .find(
      {
        walletId: walletId,
        creatorId: creatorId,
        dataType: dataType.TXS,
      },
      {
        limit: limit || 5,
      },
    )
    .sort({
      createdOn: -1,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      var txs = _.map(result, function(tx) {
        return Model.TxProposal.fromObj(tx);
      });
      return cb(null, txs);
    });
};

Storage.prototype.fetchPendingTxs = function(walletId, cb) {
  var self = this;

  self.db
    .collection(collectionName)
    .find({
      walletId: walletId,
      isPending: true,
      dataType: dataType.TXS,
    })
    .sort({
      createdOn: -1,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      var txs = _.map(result, function(tx) {
        return Model.TxProposal.fromObj(tx);
      });
      return self._completeTxData(walletId, txs, cb);
    });
};

/**
 * fetchTxs. Times are in UNIX EPOCH (seconds)
 *
 * @param walletId
 * @param opts.minTs
 * @param opts.maxTs
 * @param opts.limit
 */
Storage.prototype.fetchTxs = function(walletId, opts, cb) {
  var self = this;

  opts = opts || {};

  var tsFilter = {};
  if (_.isNumber(opts.minTs)) tsFilter.$gte = opts.minTs;
  if (_.isNumber(opts.maxTs)) tsFilter.$lte = opts.maxTs;

  var filter = {
    walletId: walletId,
    dataType: dataType.TXS,
  };
  if (!_.isEmpty(tsFilter)) filter.createdOn = tsFilter;

  var mods = {};
  if (_.isNumber(opts.limit)) mods.limit = opts.limit;

  this.db
    .collection(collectionName)
    .find(filter, mods)
    .sort({
      createdOn: -1,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      var txs = _.map(result, function(tx) {
        return Model.TxProposal.fromObj(tx);
      });
      return self._completeTxData(walletId, txs, cb);
    });
};

/**
 * fetchBroadcastedTxs. Times are in UNIX EPOCH (seconds)
 *
 * @param walletId
 * @param opts.minTs
 * @param opts.maxTs
 * @param opts.limit
 */
Storage.prototype.fetchBroadcastedTxs = function(walletId, opts, cb) {
  var self = this;

  opts = opts || {};

  var tsFilter = {};
  if (_.isNumber(opts.minTs)) tsFilter.$gte = opts.minTs;
  if (_.isNumber(opts.maxTs)) tsFilter.$lte = opts.maxTs;

  var filter = {
    walletId: walletId,
    status: 'broadcasted',
    dataType: dataType.TXS,
  };
  if (!_.isEmpty(tsFilter)) filter.broadcastedOn = tsFilter;

  var mods = {};
  if (_.isNumber(opts.limit)) mods.limit = opts.limit;

  this.db
    .collection(collectionName)
    .find(filter, mods)
    .sort({
      createdOn: -1,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      var txs = _.map(result, function(tx) {
        return Model.TxProposal.fromObj(tx);
      });
      return self._completeTxData(walletId, txs, cb);
    });
};

/**
 * Retrieves notifications after a specific id or from a given ts (whichever is more recent).
 *
 * @param {String|String[]} walletId
 * @param {String} notificationId
 * @param {Number} minTs
 * @returns {Notification[]} Notifications
 */
Storage.prototype.fetchNotifications = function(walletId, notificationId, minTs, cb) {
  function makeId(timestamp) {
    return _.padLeft(timestamp, 14, '0') + _.repeat('0', 4);
  }

  var self = this;

  var minId = makeId(minTs);
  if (notificationId) {
    minId = notificationId > minId ? notificationId : minId;
  }

  var query = {
    walletId: walletId,
    id: {
      $gt: minId,
    },
    dataType: dataType.NOTIFICATIONS,
  };

  if (_.isArray(walletId)) {
    query.walletId = { $in: walletId };
  }

  this.db
    .collection(collectionName)
    .find(query)
    .sort({
      id: 1,
    })
    .toArray(function(err, result) {
      if (err) {
        setTimeout(() => cb(err), 0);
        return;
      }
      if (!result) {
        setTimeout(() => cb(), 0);
        return;
      }
      var notifications = _.map(result, Model.Notification.fromObj);
      setTimeout(() => cb(null, notifications), 0);
    });
};

// TODO: remove walletId from signature
Storage.prototype.storeNotification = function(walletId, notification, cb) {
  this.db.collection(collectionName).insert(
    { ...notification, dataType: dataType.NOTIFICATIONS },
    {
      w: 1,
    },
    cb,
  );
};

// TODO: remove walletId from signature
Storage.prototype.storeTx = function(walletId, txp, cb) {
  this.db.collection(collectionName).update(
    {
      id: txp.id,
      walletId: walletId,
      dataType: dataType.TXS,
    },
    { ...txp.toObject(), dataType: dataType.TXS },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.removeTx = function(walletId, txProposalId, cb) {
  this.db.collection(collectionName).findAndRemove(
    {
      id: txProposalId,
      walletId: walletId,
      dataType: dataType.TXS,
    },
    {
      w: 1,
    },
    cb,
  );
};

Storage.prototype.removeWallet = function(walletId, cb) {
  var self = this;

  async.parallel(
    [
      function(next) {
        self.db.collection(collectionName).findAndRemove(
          {
            id: walletId,
            dataType: dataType.WALLETS,
          },
          next,
        );
      },
      function(next) {
        var otherDatatypes = _.without(_.values(dataType), dataType.WALLETS);
        async.each(
          otherDatatypes,
          function(dt, next) {
            self.db.collection(collectionName).remove(
              {
                walletId: walletId,
                dataType: dt,
              },
              next,
            );
          },
          next,
        );
      },
    ],
    cb,
  );
};

Storage.prototype.fetchAddresses = function(walletId, cb) {
  var self = this;

  this.db
    .collection(collectionName)
    .find({
      walletId: walletId,
      dataType: dataType.ADDRESSES,
    })
    .sort({
      createdOn: 1,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      var addresses = _.map(result, function(address) {
        return Model.Address.fromObj(address);
      });
      return cb(null, addresses);
    });
};

Storage.prototype.fetchNewAddresses = function(walletId, fromTs, cb) {
  var self = this;

  this.db
    .collection(collectionName)
    .find({
      walletId: walletId,
      createdOn: {
        $gte: fromTs,
      },
      dataType: dataType.ADDRESSES,
    })
    .sort({
      createdOn: 1,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      var addresses = _.map(result, function(address) {
        return Model.Address.fromObj(address);
      });
      return cb(null, addresses);
    });
};

Storage.prototype.countAddresses = function(walletId, cb) {
  this.db
    .collection(collectionName)
    .find({
      walletId: walletId,
      dataType: dataType.ADDRESSES,
    })
    .count(cb);
};

Storage.prototype.storeAddress = function(address, cb) {
  var self = this;

  self.db.collection(collectionName).update(
    {
      walletId: address.walletId,
      address: address.address,
      dataType: dataType.ADDRESSES,
    },
    { ...address, dataType: dataType.ADDRESSES },
    {
      w: 1,
      upsert: false,
    },
    cb,
  );
};

Storage.prototype.storeAddressAndWallet = function(wallet, addresses, cb) {
  var self = this;

  var addresses = [].concat(addresses);
  if (_.isEmpty(addresses)) return cb();
  addresses = addresses.map((address) => ({
    ...address,
    dataType: dataType.ADDRESSES,
  }));

  self.db.collection(collectionName).insert(
    addresses,
    {
      w: 1,
    },
    function(err) {
      if (err) return cb(err);
      self.storeWallet(wallet, cb);
    },
  );
};

Storage.prototype.fetchAddressByWalletId = function(walletId, address, cb) {
  var self = this;

  this.db.collection(collectionName).findOne(
    {
      walletId: walletId,
      address: address,
      dataType: dataType.ADDRESSES,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();

      return cb(null, Model.Address.fromObj(result));
    },
  );
};

Storage.prototype.fetchAddressByCoin = function(coin, address, cb) {
  var self = this;
  if (!this.db) return cb();

  this.db
    .collection(collectionName)
    .find({
      address: address,
      dataType: dataType.ADDRESSES,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result || _.isEmpty(result)) return cb();
      if (result.length > 1) {
        result = _.find(result, function(address) {
          return coin == (address.coin || 'btc');
        });
      } else {
        result = _.first(result);
      }
      if (!result) return cb();

      return cb(null, Model.Address.fromObj(result));
    });
};

Storage.prototype.fetchAddressesByInfo = function(addressInfos, cb) {
  var self = this;
  if (!this.db) return cb();

  var addressesQuery = _.map(addressInfos, function(a) {
    return {
      $elemMatch: {
        address: a.address,
        coin: a.coin,
        dataType: dataType.ADDRESSES,
      },
    };
  });

  this.db
    .collection(collectionName)
    .find({
      $or: addressesQuery,
    })
    .toArray(function(err, result) {
      if (err) {
        setTimeout(() => cb(err), 0);
        return;
      }
      if (!result || _.isEmpty(result)) {
        setTimeout(() => cb(), 0);
        return;
      }
      var addressResults = _.map(result, Model.Address.fromObj);
      setTimeout(() => cb(null, addressResults), 0);
    });
};

Storage.prototype.fetchPreferences = function(walletId, copayerId, cb) {
  this.db
    .collection(collectionName)
    .find({
      walletId: walletId,
      dataType: dataType.PREFERENCES,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);

      if (copayerId) {
        result = _.find(result, {
          copayerId: copayerId,
        });
      }
      if (!result) return cb();

      var preferences = _.map([].concat(result), function(r) {
        return Model.Preferences.fromObj(r);
      });
      if (copayerId) {
        preferences = preferences[0];
      }
      return cb(null, preferences);
    });
};

Storage.prototype.storePreferences = function(preferences, cb) {
  this.db.collection(collectionName).update(
    {
      walletId: preferences.walletId,
      copayerId: preferences.copayerId,
      dataType: dataType.PREFERENCES,
    },
    { ...preferences, dataType: dataType.PREFERENCES },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.storeEmail = function(email, cb) {
  this.db.collection(collectionName).update(
    {
      id: email.id,
      dataType: dataType.EMAIL_QUEUE,
    },
    { ...email, dataType: dataType.EMAIL_QUEUE },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.fetchUnsentEmails = function(cb) {
  this.db
    .collection(collectionName)
    .find({
      status: 'pending',
      dataType: dataType.EMAIL_QUEUE,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);
      if (!result || _.isEmpty(result)) return cb(null, []);
      return cb(null, Model.Email.fromObj(result));
    });
};

Storage.prototype.fetchEmailByNotification = function(notificationId, cb) {
  this.db.collection(collectionName).findOne(
    {
      notificationId: notificationId,
      dataType: dataType.EMAIL_QUEUE,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();

      return cb(null, Model.Email.fromObj(result));
    },
  );
};

Storage.prototype.storeTwoStepCache = function(walletId, cacheStatus, cb) {
  var self = this;
  self.db.collection(collectionName).update(
    {
      walletId: walletId,
      type: 'twoStep',
      key: null,
      dataType: dataType.CACHE,
    },
    {
      $set: {
        addressCount: cacheStatus.addressCount,
        lastEmpty: cacheStatus.lastEmpty,
      },
    },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.getTwoStepCache = function(walletId, cb) {
  var self = this;

  self.db.collection(collectionName).findOne(
    {
      walletId: walletId,
      type: 'twoStep',
      key: null,
      dataType: dataType.CACHE,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      return cb(null, result);
    },
  );
};

Storage.prototype.storeAddressesWithBalance = function(walletId, addresses, cb) {
  var self = this;

  if (_.isEmpty(addresses)) addresses = [];

  self.db.collection(collectionName).update(
    {
      walletId: walletId,
      type: 'addressesWithBalance',
      key: null,
      dataType: dataType.CACHE,
    },
    {
      $set: {
        addresses: addresses,
      },
    },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.fetchAddressesWithBalance = function(walletId, cb) {
  var self = this;

  self.db.collection(collectionName).findOne(
    {
      walletId: walletId,
      type: 'addressesWithBalance',
      key: null,
      dataType: dataType.CACHE,
    },
    function(err, result) {
      if (err) {
        setTimeout(() => cb(err), 0);
        return;
      }
      if (_.isEmpty(result)) {
        setTimeout(() => cb(null, []), 0);
        return;
      }

      self.db
        .collection(collectionName)
        .find({
          walletId: walletId,
          address: { $in: result.addresses },
          dataType: dataType.ADDRESSES,
        })
        .toArray(function(err, result2) {
          if (err) {
            setTimeout(() => cb(err), 0);
            return;
          }
          if (!result2) {
            setTimeout(() => cb(null, []), 0);
            return;
          }

          var addresses = _.map(result2, Model.Address.fromObj);
          setTimeout(() => cb(null, addresses), 0);
        });
    },
  );
};

// --------         ---------------------------  Total
//           > Time >
//                       ^to     <=  ^from
//                       ^fwdIndex  =>  ^end
Storage.prototype.getTxHistoryCache = function(walletId, from, to, cb) {
  var self = this;
  $.checkArgument(from >= 0);
  $.checkArgument(from <= to);

  self.db.collection(collectionName).findOne(
    {
      walletId: walletId,
      type: 'historyCacheStatus',
      key: null,
      dataType: dataType.CACHE,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      if (!result.isUpdated) return cb();

      // Reverse indexes
      var fwdIndex = result.totalItems - to;

      if (fwdIndex < 0) {
        fwdIndex = 0;
      }

      var end = result.totalItems - from;

      // nothing to return
      if (end <= 0) return cb(null, []);

      // Cache is OK.
      self.db
        .collection(collectionName)
        .find({
          walletId: walletId,
          type: 'historyCache',
          key: {
            $gte: fwdIndex,
            $lt: end,
          },
          dataType: dataType.CACHE,
        })
        .sort({
          key: -1,
        })
        .toArray(function(err, result) {
          if (err) return cb(err);

          if (!result) return cb();

          if (result.length < end - fwdIndex) {
            // some items are not yet defined.
            return cb();
          }

          var txs = _.map(result, 'tx');
          return cb(null, txs);
        });
    },
  );
};

Storage.prototype.softResetAllTxHistoryCache = function(cb) {
  this.db.collection(collectionName).update(
    {
      type: 'historyCacheStatus',
      dataType: dataType.CACHE,
    },
    {
      $set: {
        isUpdated: false,
      },
    },
    {
      multi: true,
    },
    cb,
  );
};

Storage.prototype.softResetTxHistoryCache = function(walletId, cb) {
  this.db.collection(collectionName).update(
    {
      walletId: walletId,
      type: 'historyCacheStatus',
      key: null,
      dataType: dataType.CACHE,
    },
    {
      $set: {
        isUpdated: false,
      },
    },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.clearTxHistoryCache = function(walletId, cb) {
  var self = this;
  self.db.collection(collectionName).remove(
    {
      walletId: walletId,
      type: 'historyCache',
      dataType: dataType.CACHE,
    },
    {
      multi: 1,
    },
    function(err) {
      if (err) return cb(err);
      self.db.collection(collectionName).remove(
        {
          walletId: walletId,
          type: 'historyCacheStatus',
          key: null,
          dataType: dataType.CACHE,
        },
        {
          w: 1,
        },
        cb,
      );
    },
  );
};

// items should be in CHRONOLOGICAL order
Storage.prototype.storeTxHistoryCache = function(walletId, totalItems, firstPosition, items, cb) {
  $.shouldBeNumber(firstPosition);
  $.checkArgument(firstPosition >= 0);
  $.shouldBeNumber(totalItems);
  $.checkArgument(totalItems >= 0);

  var self = this;

  _.each(items, function(item, i) {
    item.position = firstPosition + i;
  });
  var cacheIsComplete = firstPosition == 0;

  // TODO: check txid uniqness?
  async.each(
    items,
    function(item, next) {
      var pos = item.position;
      delete item.position;
      self.db.collection(collectionName).update(
        {
          walletId: walletId,
          type: 'historyCache',
          key: pos,
          dataType: dataType.CACHE,
        },
        {
          walletId: walletId,
          type: 'historyCache',
          key: pos,
          tx: item,
        },
        {
          w: 1,
          upsert: true,
        },
        next,
      );
    },
    function(err) {
      if (err) return cb(err);

      self.db.collection(collectionName).update(
        {
          walletId: walletId,
          type: 'historyCacheStatus',
          key: null,
          dataType: dataType.CACHE,
        },
        {
          walletId: walletId,
          type: 'historyCacheStatus',
          key: null,
          totalItems: totalItems,
          updatedOn: Date.now(),
          isComplete: cacheIsComplete,
          isUpdated: true,
        },
        {
          w: 1,
          upsert: true,
        },
        cb,
      );
    },
  );
};

Storage.prototype.storeFiatRate = function(providerName, rates, cb) {
  var self = this;

  var now = Date.now();
  async.each(
    rates,
    function(rate, next) {
      self.db.collection(collectionName).insert(
        {
          provider: providerName,
          ts: now,
          code: rate.code,
          value: rate.value,
          dataType: dataType.FIAT_RATES,
        },
        {
          w: 1,
        },
        next,
      );
    },
    cb,
  );
};

Storage.prototype.fetchFiatRate = function(providerName, code, ts, cb) {
  var self = this;
  self.db
    .collection(collectionName)
    .find({
      provider: providerName,
      code: code,
      ts: {
        $lte: ts,
      },
      dataType: dataType.FIAT_RATES,
    })
    .sort({
      ts: -1,
    })
    .limit(1)
    .toArray(function(err, result) {
      if (err || _.isEmpty(result)) return cb(err);
      return cb(null, result[0]);
    });
};

Storage.prototype.fetchTxNote = function(walletId, txid, cb) {
  var self = this;

  self.db.collection(collectionName).findOne(
    {
      walletId: walletId,
      txid: txid,
      dataType: dataType.TX_NOTES,
    },
    function(err, result) {
      if (err) return cb(err);
      if (!result) return cb();
      return self._completeTxNotesData(walletId, Model.TxNote.fromObj(result), cb);
    },
  );
};

// TODO: should be done client-side
Storage.prototype._completeTxNotesData = function(walletId, notes, cb) {
  var self = this;

  self.fetchWallet(walletId, function(err, wallet) {
    if (err) return cb(err);
    _.each([].concat(notes), function(note) {
      note.editedByName = wallet.getCopayer(note.editedBy).name;
    });
    return cb(null, notes);
  });
};

/**
 * fetchTxNotes. Times are in UNIX EPOCH (seconds)
 *
 * @param walletId
 * @param opts.minTs
 */
Storage.prototype.fetchTxNotes = function(walletId, opts, cb) {
  var self = this;

  var filter = {
    walletId: walletId,
    dataType: dataType.TX_NOTES,
  };
  if (_.isNumber(opts.minTs))
    filter.editedOn = {
      $gte: opts.minTs,
    };
  this.db
    .collection(collectionName)
    .find(filter)
    .toArray(function(err, result) {
      if (err) return cb(err);
      var notes = _.compact(
        _.map(result, function(note) {
          return Model.TxNote.fromObj(note);
        }),
      );
      return self._completeTxNotesData(walletId, notes, cb);
    });
};

Storage.prototype.storeTxNote = function(txNote, cb) {
  this.db.collection(collectionName).update(
    {
      txid: txNote.txid,
      walletId: txNote.walletId,
      dataType: dataType.TX_NOTES,
    },
    { ...txNote.toObject(), dataType: dataType.TX_NOTES },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.getSession = function(copayerId, cb) {
  var self = this;

  self.db.collection(collectionName).findOne(
    {
      copayerId: copayerId,
      dataType: dataType.SESSIONS,
    },
    function(err, result) {
      if (err || !result) return cb(err);
      return cb(null, Model.Session.fromObj(result));
    },
  );
};

Storage.prototype.storeSession = function(session, cb) {
  this.db.collection(collectionName).update(
    {
      copayerId: session.copayerId,
      dataType: dataType.SESSIONS,
    },
    { ...session.toObject(), dataType: dataType.SESSIONS },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.fetchPushNotificationSubs = function(copayerId, cb) {
  this.db
    .collection(collectionName)
    .find({
      copayerId: copayerId,
      dataType: dataType.PUSH_NOTIFICATION_SUBS,
    })
    .toArray(function(err, result) {
      if (err) return cb(err);

      if (!result) return cb();

      var tokens = _.map([].concat(result), function(r) {
        return Model.PushNotificationSub.fromObj(r);
      });
      return cb(null, tokens);
    });
};

Storage.prototype.storePushNotificationSub = function(pushNotificationSub, cb) {
  this.db.collection(collectionName).update(
    {
      copayerId: pushNotificationSub.copayerId,
      token: pushNotificationSub.token,
      dataType: dataType.PUSH_NOTIFICATION_SUBS,
    },
    { ...pushNotificationSub, dataType: dataType.PUSH_NOTIFICATION_SUBS },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.removePushNotificationSub = function(copayerId, token, cb) {
  this.db.collection(collectionName).remove(
    {
      copayerId: copayerId,
      token: token,
      dataType: dataType.PUSH_NOTIFICATION_SUBS,
    },
    {
      w: 1,
    },
    cb,
  );
};

Storage.prototype.fetchActiveTxConfirmationSubs = function(copayerId, cb) {
  var filter = {
    isActive: true,
    dataType: dataType.TX_CONFIRMATION_SUBS,
  };
  if (copayerId) filter.copayerId = copayerId;

  this.db
    .collection(collectionName)
    .find(filter)
    .toArray(function(err, result) {
      if (err) return cb(err);

      if (!result) return cb();

      var subs = _.map([].concat(result), function(r) {
        return Model.TxConfirmationSub.fromObj(r);
      });
      return cb(null, subs);
    });
};

Storage.prototype.storeTxConfirmationSub = function(txConfirmationSub, cb) {
  this.db.collection(collectionName).update(
    {
      copayerId: txConfirmationSub.copayerId,
      txid: txConfirmationSub.txid,
      dataType: dataType.TX_CONFIRMATION_SUBS,
    },
    { ...txConfirmationSub, dataType: dataType.TX_CONFIRMATION_SUBS },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype.removeTxConfirmationSub = function(copayerId, txid, cb) {
  this.db.collection(collectionName).remove(
    {
      copayerId: copayerId,
      txid: txid,
      dataType: dataType.TX_CONFIRMATION_SUBS,
    },
    {
      w: 1,
    },
    cb,
  );
};

Storage.prototype._dump = function(cb, fn) {
  fn = fn || console.log;
  cb = cb || function() {};

  var self = this;
  this.db.collections(function(err, collections) {
    if (err) return cb(err);
    async.eachSeries(
      collections,
      function(col, next) {
        col.find().toArray(function(err, items) {
          fn('--------', col.s.name);
          fn(items);
          fn('------------------------------------------------------------------\n\n');
          next(err);
        });
      },
      cb,
    );
  });
};

Storage.prototype.fetchAddressIndexCache = function(walletId, key, cb) {
  this.db.collection(collectionName).findOne(
    {
      walletId: walletId,
      type: 'addressIndexCache',
      key: key,
      dataType: dataType.CACHE,
    },
    function(err, ret) {
      if (err) return cb(err);
      if (!ret) return cb();
      cb(null, ret.index);
    },
  );
};

Storage.prototype.storeAddressIndexCache = function(walletId, key, index, cb) {
  this.db.collection(collectionName).update(
    {
      walletId: walletId,
      type: 'addressIndexCache',
      key: key,
      dataType: dataType.CACHE,
    },
    {
      $set: {
        index: index,
      },
    },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.prototype._addressHash = function(addresses) {
  var all = addresses.join();
  return Bitcore.crypto.Hash.ripemd160(new Buffer(all)).toString('hex');
};

Storage.prototype.checkAndUseBalanceCache = function(walletId, addresses, duration, cb) {
  var self = this;
  var key = self._addressHash(addresses);
  var now = Date.now();

  self.db.collection(collectionName).findOne(
    {
      walletId: walletId || key,
      type: 'balanceCache',
      key: key,
      dataType: dataType.CACHE,
    },
    function(err, ret) {
      if (err) return cb(err);
      if (!ret) return cb();

      var validFor = ret.ts + duration * 1000 - now;

      if (validFor > 0) {
        log.debug('', 'Using Balance Cache valid for %d ms more', validFor);
        cb(null, ret.result);
        return true;
      }
      cb();

      log.debug('', 'Balance cache expired, deleting');
      self.db.collection(collectionName).remove(
        {
          walletId: walletId,
          type: 'balanceCache',
          key: key,
          dataType: dataType.CACHE,
        },
        {},
        function() {},
      );

      return false;
    },
  );
};

Storage.prototype.storeBalanceCache = function(walletId, addresses, balance, cb) {
  var key = this._addressHash(addresses);
  var now = Date.now();

  this.db.collection(collectionName).update(
    {
      walletId: walletId || key,
      type: 'balanceCache',
      key: key,
      dataType: dataType.CACHE,
    },
    {
      $set: {
        ts: now,
        result: balance,
      },
    },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

// FEE_LEVEL_DURATION = 5min
var FEE_LEVEL_DURATION = 5 * 60 * 1000;
Storage.prototype.checkAndUseFeeLevelsCache = function(opts, cb) {
  var self = this;
  var key = JSON.stringify(opts);
  var now = Date.now();

  self.db.collection(collectionName).findOne(
    {
      walletId: null,
      type: 'feeLevels',
      key: key,
      dataType: dataType.CACHE,
    },
    function(err, ret) {
      if (err) return cb(err);
      if (!ret) return cb();

      var validFor = ret.ts + FEE_LEVEL_DURATION - now;
      return cb(null, validFor > 0 ? ret.result : null);
    },
  );
};

Storage.prototype.storeFeeLevelsCache = function(opts, values, cb) {
  var key = JSON.stringify(opts);
  var now = Date.now();
  this.db.collection(collectionName).update(
    {
      walletId: null,
      type: 'feeLevels',
      key: key,
      dataType: dataType.CACHE,
    },
    {
      $set: {
        ts: now,
        result: values,
      },
    },
    {
      w: 1,
      upsert: true,
    },
    cb,
  );
};

Storage.collections = dataType;
module.exports = Storage;
