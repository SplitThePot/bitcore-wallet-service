var config = {
  basePath: '/bws/api',
  disableLogs: false,
  port: 3232,

  // Uncomment to make BWS a forking server
  // cluster: true,

  // Uncomment to set the number or process (will use the nr of availalbe CPUs by default)
  // clusterInstances: 4,

  // https: true,
  // privateKeyFile: 'private.pem',
  // certificateFile: 'cert.pem',
  ////// The following is only for certs which are not
  ////// trusted by nodejs 'https' by default
  ////// CAs like Verisign do not require this
  // CAinter1: '', // ex. 'COMODORSADomainValidationSecureServerCA.crt'
  // CAinter2: '', // ex. 'COMODORSAAddTrustCA.crt'
  // CAroot: '', // ex. 'AddTrustExternalCARoot.crt'

  storageOpts: {
    mongoDb: {
      uri: process.env['MONGO_STRING'], // "mongodb://localhost:27017/bws",
      dbName: process.env['MONGO_DBNAME'], // "bws"
      collectionName: process.env['MONGO_COLLECTION'], // "bws"
    },
  },
  lockOpts: {
    //  To use locker-server, uncomment this:
    lockerServer: {
      host: process.env['LOCKER_SERVICE'], // "localhost",
      port: 3231,
    },
  },
  messageBrokerOpts: {
    //  To use message broker server, uncomment this:
    messageBrokerServer: {
      url: process.env['MESSAGEBROKER_SERVICE'], // "http://localhost:3380"
    },
  },
  blockchainExplorerOpts: {
    btc: {
      livenet: {
        provider: 'insight',
        url: ['http://:3001'],
      },
      testnet: {
        provider: 'insight',
        url: ['http://52.137.26.30:3001'],
      },
    },
    // bch: {
    //   livenet: {
    //     provider: 'insight',
    //     url: ['https://bitcoincash.blockexplorer.com' /*'https://bch.blockdozer.com',  'https://bch-insight.bitpay.com:443'*/],
    //     addressFormat: 'cashaddr', // copay, cashaddr, or legacy
    //   },
    //   // testnet: {
    //   //   provider: 'insight',
    //   //   url: ['https://tbch.blockdozer.com' /*,'https://test-bch-insight.bitpay.com:443'*/],
    //   //   addressFormat: 'cashaddr', // copay, cashaddr, or legacy
    //   // },
    // },
  },
  // pushNotificationsOpts: {
  //   templatePath: "./lib/templates",
  //   defaultLanguage: "en",
  //   defaultUnit: "btc",
  //   subjectPrefix: "",
  //   pushServerUrl: "https://fcm.googleapis.com/fcm",
  //   authorizationKey: "You_have_to_put_something_here"
  // },
  fiatRateServiceOpts: {
    defaultProvider: 'BitPay',
    fetchInterval: 60, // in minutes
  },
  // To use email notifications uncomment this:
  // emailOpts: {
  //  host: 'localhost',
  //  port: 25,
  //  ignoreTLS: true,
  //  subjectPrefix: '[Wallet Service]',
  //  from: 'wallet-service@bitcore.io',
  //  templatePath: './lib/templates',
  //  defaultLanguage: 'en',
  //  defaultUnit: 'btc',
  //  publicTxUrlTemplate: {
  //    btc: {
  //      livenet: 'https://insight.bitpay.com/tx/{{txid}}',
  //      testnet: 'https://test-insight.bitpay.com/tx/{{txid}}',
  //    },
  //    bch: {
  //      livenet: 'https://bch-insight.bitpay.com/#/tx/{{txid}}',
  //      testnet: 'https://test-bch-insight.bitpay.com/#/tx/{{txid}}',
  //    }
  //  },
  // },
  // To use sendgrid:
  // var sgTransport = require('nodemail-sendgrid-transport');
  // mailer:sgTransport({
  //  api_user: xxx,
  //  api_key: xxx,
  // });
};
module.exports = config;
