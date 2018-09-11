#!/bin/bash

pm2 start --only bcmonitor -node-args="--expose-gc --inspect=0.0.0.0:9229"
pm2 start --only bws

pm2 logs
