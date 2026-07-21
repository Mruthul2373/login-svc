FROM nginx:alpine

COPY index.html /usr/share/nginx/html/index.html

RUN printf 'server {\n\
listen 8081;\n\
location / {\n\
root /usr/share/nginx/html;\n\
try_files $uri /index.html;\n\
}\n\
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8081
