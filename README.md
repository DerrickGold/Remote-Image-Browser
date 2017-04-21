# Remote-Image-Browser

Browser your pictures from your own server right through your browser.

##Desktop Browser
Pictures Coming soon!

##Mobile Browser
Pictures Coming soon!

## Requirements
- python3 (3.4 and 3.5 tested)

## Installation
Simply run:

`pip3 install -r requirements.txt`

to install python dependencies.


## Running the Server
To start the server:

`rib.py [-p <PORT NUMBER>] <Picture Directory>`

Picture directory must be located within the directory that the server is started in. This can be done with a symlink.

## Accessing the Player

To get to the image browser, visit this address in any browser:

`127.0.0.1:<PORT NUMBER>/gui`

