#!/bin/sh
set -e

GATEWAY=$(ip route | grep '^default' | cut -d' ' -f3)

# mac specific docker gateway
GATEWAY_MAC="$(getent hosts docker.for.mac.localhost | cut -d' ' -f1)"
if [ -n "$GATEWAY_MAC" ]; then
    GATEWAY=$GATEWAY_MAC
fi

# windows specific docker gateway
GATEWAY_WIN="$(getent hosts host.docker.internal | cut -d' ' -f1)"
if [ -n "$GATEWAY_WIN" ]; then
    GATEWAY=$GATEWAY_WIN
fi   

echo "Docker Host Gateway: $GATEWAY"

iptables -t nat -I PREROUTING -p tcp --match multiport --dports "${PORTS:-'0:65535'}" -j DNAT --to-destination ${GATEWAY}
iptables -t nat -I POSTROUTING -j MASQUERADE

# run forever
tail -f /dev/null