## data-server
#
# https://github.com/ccmjs/data-server
#
# Version 1.0.0

# use Docker's nodejs, which is based on debian
FROM node:latest

# set maintainer lable
LABEL maintainer="rene.mueller@smail.inf.h-brs.de"

# set working directory
WORKDIR /usr/src/data-server

# copy files into the image
COPY index.js /usr/src/data-server/index.js
COPY configs.json /usr/src/data-server/configs.json
COPY package.json /usr/src/data-server/package.json

# install dependencies
RUN npm i -g npm && npm i --no-save

# set entrypoint for this image
ENTRYPOINT ["/usr/local/bin/npm", "run", "server"]
