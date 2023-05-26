# data-server
ccm-compatible NodeJS webserver for server-side data management via HTTP using MongoDB and CORS.

See Wiki page for more informations.

## Docker

### Step 1: Build image
    # replace <name> with your name
    docker build --tag <name>/data-server .

### Step 2: Run mongo container (optional)
    docker run \
        --detach \
        --restart   unless-stopped  \
        --name      mongo     \
        --publish   27017:27017       \
        mongo:latest
    
    # show ip of mongo container -> add this ip to your configs.json
    docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' mongo

### Step 3: Run data-server container
    # replace <name> with your name
    # check if this port matches with your configs.json
    docker run                      \
        --detach                    \
        --restart   unless-stopped  \
        --name      data-server     \
        --publish   8080:8080       \
        <name>>/data-server
        