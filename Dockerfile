FROM node:8
RUN apt-get update && apt-get install -y --no-install-recommends mongodb-clients && rm -rf /var/lib/apt/lists/*
RUN npm set progress=false && npm config set depth 0
RUN npm i -g npm@latest
RUN npm i -g pm2@3.0.0
WORKDIR /bws
RUN mkdir -p logs
ADD package*.json ./
RUN npm install --production
RUN npm audit fix
ADD . .
EXPOSE 3232 3231 3380 443