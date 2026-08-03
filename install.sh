#!/bin/bash
set -e

REPO="sythoria/sythoria-desktop"

echo "Fetching latest version information..."
# Fetch the latest release tag from GitHub API
LATEST_TAG=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
    echo "Error: Could not fetch latest release version from GitHub."
    exit 1
fi

VERSION=${LATEST_TAG#v} # Removes the 'v' prefix if it exists

echo "Detected latest Sythoria version: $VERSION"

# Detect the operating system
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    OS_LIKE=$ID_LIKE
else
    echo "Cannot detect Linux distribution. Unsupported system."
    exit 1
fi

TMP_DIR=$(mktemp -d)
cd $TMP_DIR

install_deb() {
    echo "Downloading Debian/Ubuntu (.deb) package..."
    URL="https://github.com/$REPO/releases/download/$LATEST_TAG/Sythoria_${VERSION}_amd64.deb"
    curl -LO $URL
    echo "Installing..."
    sudo apt-get update
    sudo apt-get install -y ./Sythoria_${VERSION}_amd64.deb
}

install_rpm() {
    echo "Downloading Fedora/RHEL (.rpm) package..."
    URL="https://github.com/$REPO/releases/download/$LATEST_TAG/Sythoria-${VERSION}-1.x86_64.rpm"
    curl -LO $URL
    echo "Installing..."
    sudo dnf install -y ./Sythoria-${VERSION}-1.x86_64.rpm
}

install_appimage() {
    echo "Downloading universal AppImage..."
    URL="https://github.com/$REPO/releases/download/$LATEST_TAG/Sythoria_${VERSION}_amd64.AppImage"
    curl -LO $URL
    
    echo "Installing AppImage..."
    mkdir -p ~/.local/bin
    mv ./Sythoria_${VERSION}_amd64.AppImage ~/.local/bin/sythoria
    chmod +x ~/.local/bin/sythoria

    echo "Creating desktop menu entry..."
    mkdir -p ~/.local/share/applications
    cat <<EOF > ~/.local/share/applications/sythoria.desktop
[Desktop Entry]
Name=Sythoria
Exec=$HOME/.local/bin/sythoria
Icon=sythoria
Type=Application
Categories=Utility;Chat;
EOF
    echo "Sythoria installed! You can launch it from your application menu."
}

# Route to the correct installer based on OS
case $OS in
    ubuntu|debian|linuxmint|pop)
        install_deb
        ;;
    fedora|centos|rhel)
        install_rpm
        ;;
    *)
        # Check ID_LIKE for derivatives (e.g., a distro based on Ubuntu but with a different ID)
        case $OS_LIKE in
            *debian*|*ubuntu*) install_deb ;;
            *fedora*|*rhel*) install_rpm ;;
            *)
                echo "Distribution '$OS' does not use apt or dnf."
                echo "Falling back to universal AppImage installation..."
                install_appimage
                ;;
        esac
        ;;
esac

# Cleanup temp files
rm -rf $TMP_DIR
echo "Installation complete!"
