FROM python:3.11-slim

# Install system tools for KOTH
RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap \
    curl \
    wget \
    netcat-traditional \
    iputils-ping \
    dnsutils \
    whois \
    hydra \
    openssh-client \
    openvpn \
    git \
    perl \
    && rm -rf /var/lib/apt/lists/*

# Install nikto from source (not in slim repos)
RUN git clone https://github.com/sullo/nikto.git /opt/nikto

# Install Python dependencies
RUN pip install flask flask-cors

# Create AEGIS directories
RUN mkdir -p /opt/aegis/workspace

# Copy the bridge server
WORKDIR /app
COPY core.py .

# Add nikto to PATH
ENV PATH="/opt/nikto/program:${PATH}"

# Expose the bridge port
EXPOSE 5005

# Run
CMD ["python", "core.py"]
