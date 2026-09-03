FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Stable system dependencies for the Cloud Agent: build tooling, git/curl and a
# local PostgreSQL 16 server (the app requires a real PostgreSQL, never SQLite).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        sudo \
        build-essential \
        openssl \
        postgresql \
        postgresql-contrib \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 (satisfies the package.json engines constraint and matches CI).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# The base image ships a non-root `ubuntu` user (uid 1000). Grant it
# passwordless sudo so the bootstrap scripts can manage the local database.
RUN echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu

USER ubuntu
WORKDIR /home/ubuntu
