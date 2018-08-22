#!/bin/bash

pm2 start --only bcmonitor
pm2 start --only fiatrateservice
pm2 start --only bws

pm2 logs
