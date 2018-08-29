module.exports = {
  apps: [
    {
      name: "bws",
      script: "./bws.js",
      log: "./logs/bws.log",
      log_type: "json",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    },
    {
      name: "messagebroker",
      script: "./messagebroker/messagebroker.js",
      log: "./logs/messagebroker.log",
      log_type: "json",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    },
    {
      name: "bcmonitor",
      script: "./bcmonitor/bcmonitor.js",
      log: "./logs/bcmonitor.log",
      log_type: "json",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    },
    {
      name: "fiatrateservice",
      script: "./fiatrateservice/fiatrateservice.js",
      log: "./logs/fiatrateservice.log",
      log_type: "json",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    },
    {
      name: "locker",
      script: "./locker/locker.js",
      log: "./logs/locker.log",
      log_type: "json",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};