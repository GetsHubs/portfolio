FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY index.html ar.html contact.html style.css favicon.svg ./
COPY api ./api
COPY runtime-server.js ./

RUN chmod -R a+rX /app

USER node

EXPOSE 8080

CMD ["node", "runtime-server.js"]
