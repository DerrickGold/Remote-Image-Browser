#!/usr/bin/env python3

from flask import Flask, request, jsonify, redirect, url_for, render_template, send_file, Response, stream_with_context
from werkzeug.datastructures import Headers
from urllib import parse
import os
import sys
import uuid
import logging
import re
import signal
import time
import shutil
from flask_cors import CORS, cross_origin
from flask_compress import Compress

app = Flask(__name__)
app.config['JSONIFY_PRETTYPRINT_REGULAR'] = False
app.config['JSON_AS_ASCII'] = False
CORS(app)
Compress(app)

logging.basicConfig(stream=sys.stderr, level=logging.DEBUG)

GLOBAL_SETTINGS = {
    'default-img': "defaultImg.jpg",
    'image-dir': '.',
    'cache-dir': '.cache',
    'server-port': 5000,
    'debug-out': True,
    'ImageListClass': None,
}

MESSAGES = {
    'file-not-exist': 'Image id {} does not exist',
}


IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".bmp"]

IMAGE_MIMETYPES = {
    'jpg': 'image/jpg',
    'png': 'image/png',
    'bmp': 'image/bmp'
}


def make_file(path, name, directory=False, parent=None):
    id = str(uuid.uuid4())
    entry = {
        'name': name,
        'directory': directory,
        'id': str(uuid.uuid4()),
        'parent': parent
    }
    
    if directory:
        entry['children'] = []
    
    return entry


def dircmp(a, b):
    if a['directory'] and not b['directory']:
        return -1
    elif not a['directory'] and b['directory']:
        return 1
    elif a['name'].lower() < b['name'].lower():
        return -1
    elif a['name'].lower() > b['name'].lower():
        return 1

    return 0


def cmp_to_key(comparator):
    'Convert a cmp= function into a key= function'
    class K(object):

        def __init__(self, obj, *args):
            self.obj = obj

        def __lt__(self, other):
            return comparator(self.obj, other.obj) < 0

        def __gt__(self, other):
            return comparator(self.obj, other.obj) > 0

        def __eq__(self, other):
            return comparator(self.obj, other.obj) == 0

        def __le__(self, other):
            return comparator(self.obj, other.obj) <= 0

        def __ge__(self, other):
            return comparator(self.obj, other.obj) >= 0

        def __ne__(self, other):
            return comparator(self.obj, other.obj) != 0

    return K

class FileHashNodeTree:
    def __init__(self, root):
        self.root = root
        self.nodes = None
        self.mappings = None
        self.pathmappings = None

    def get_files(self): return self.nodes
    def get_mapping(self): return self.mappings
    def get_pathhash(self): return self.pathmappings
        
    def scan_directory(self, path, fileExtFilter, name='.', parent='.', oldHash=None):
        oldPathHash = None
        if oldHash is not None and type(oldHash) is FileHashNodeTree:
            oldPathHash = oldHash.get_pathhash()
            
        self.nodes, self.mappings, self.pathmappings = self.scan_directory_r(path, fileExtFilter, name, parent, oldPathHash)

    def scan_directory_r(self, path, fileExtFilter, name='.', parent='.', oldPathHash=None):
        fileMapping = {}
        pathMapping = {}
        curDirPath = os.path.normpath(os.path.join(path, name))
        node = make_file(path, name, True, parent)
        fileMapping[str(node['id'])] = node
        pathMapping[curDirPath] = node
        for root, dirs, files in os.walk(curDirPath):
            newDirs = list(dirs)
            del(dirs[:])
            for file in files:
                fullpath = os.path.normpath(os.path.join(curDirPath, file))
                if oldPathHash is not None and fullpath in oldPathHash:
                    continue
            
                ext = os.path.splitext(file)
                if file[0] != '.' and ext[1] in fileExtFilter:
                    newFile = make_file(root, file, False, node['id'])
                    node['children'].append(newFile)
                    fileMapping[newFile['id']] = newFile
                    pathMapping[fullpath] = newFile

            for d in newDirs:
                childNodes, childFiles, childPaths = self.scan_directory_r(root, fileExtFilter, d, node['id'], oldPathHash)
                if len(childFiles) > 0:
                    if len(childFiles) == 1:
                        continue
                    
                    node['children'].append(childNodes)
                    fileMapping.update(childFiles)
                    pathMapping.update(childPaths)

            node['children'] = sorted(node['children'], key=cmp_to_key(dircmp))

        return node, fileMapping, pathMapping


    #If multiple scans are made to the file system, this function
    #will recurse through the new scan (which should contain only
    #the differences from the first scan with oldPathHash provided)
    #and attempt to match up node ID's with the ID's generated in the
    #initial scan
    #this resolved diff can be send to the client to merge
    def resolve_scan_diff(self, path='.', name='.', parent='.', otherFileHash=None):
        if otherFileHash is None or type(otherFileHash) is not FileHashNodeTree:
            return

        self.resolve_scan_diff_r(self.nodes, path, name, parent,  otherFileHash.get_pathhash())

    
    def resolve_scan_diff_r(self, diff, path='.', name='.', parent='.',  oldPathHash=None):
        curFile = os.path.normpath(os.path.join(path, name))
        if curFile in oldPathHash:
            diff['id'] = oldPathHash[curFile]['id']
            diff['parent'] = oldPathHash[curFile]['parent']
        else:
            diff['parent'] = parent

        if diff['directory'] and len(diff['children']):
            for c in diff['children']:
                self.resolve_scan_diff_r(c, curFile, c['name'], diff['id'], oldPathHash)


    def rm_node(self, node):
        if node['directory'] and 'children' in node:
            for child in node['children']:
                self.rm_node(child)

        parent = None
        if node['parent'] in self.mappings:
            parent = self.mappings[node['parent']]
        else:
            return
        
        for i, child in enumerate(parent['children']):
            if child['id'] == node['id']:
                parent['children'].pop(i)
                break
            
        self.mappings.pop(node['id'], None)


    def merge_scan_diff(self, otherHash):
        if otherHash is None or type(otherHash) is not FileHashNodeTree:
            return

        self.merge_scan_diff_r(otherHash.nodes, otherHash.root)
        rmPathList = []
        rmNodes = []
        # now remove any files that no longer exist in the file system
        for path in self.pathmappings:
            t = os.path.realpath(path)
            if os.path.exists(t): continue
            print("{} does not exist?".format(t))
            #if it no longer exists...
            node = self.pathmappings[path]
            if type(node) is not dict: continue
            #remove all references to that node
            #self.pathmappings.pop(path, None)
            rmPathList.append(path)
            rmNodes.append(node['id'])
            self.rm_node(node)

        for path in rmPathList: self.pathmappings.pop(path, None)
        return rmNodes

    
    def merge_scan_diff_r(self, node, path='.', name='.', top=False):
        curFileName = os.path.normpath(os.path.join(path, name))
        
        if node['id'] not in self.mappings:
            if node['parent'] != '.':
                parent = self.mappings[node['parent']]
                if not top:
                    parent['children'].append(node)
                    parent['children'] = sorted(parent['children'], key=cmp_to_key(dircmp))
                    top = True

                
            self.mappings[node['id']] = node
            self.pathmappings[curFileName] = node
        
        if node['directory'] and 'children' in node:
            for c in node['children']:
                self.merge_scan_diff_r(c, curFileName, c['name'], top)

            node['children'] = sorted(node['children'], key=cmp_to_key(dircmp))
        

class ListHistory:
    def __init__(self, date, filehash, deleted):
        self.date = date
        self.filehashnode = filehash
        self.deleted = deleted
        
class ImageList:

    def __init__(self, root):
        self.fileHash = FileHashNodeTree(root)
        self.generate_image_list(root)
        self.root = root
        self.listDiffs = []

    def generate_image_list(self, imageRoot):
        self.fileHash.scan_directory(imageRoot, IMAGE_EXT)
        self.mapping = self.fileHash.get_mapping()

    def get_file(self, identifier):
        if not identifier in self.mapping:
            logging.debug(MESSAGES['file-not-exist'].format(identifier))
            return None
        return self.mapping[identifier]

    def get_file_path(self, identifier):
        file = self.get_file(identifier)
        if file is None: return None
        curFile = file
        outpath = curFile['name']
        while curFile['parent'] != '.':
            parent = self.get_file(curFile['parent'])
            outpath = os.path.join(parent['name'], outpath)
            curFile = parent

        return os.path.join(GLOBAL_SETTINGS['image-dir'], outpath)

    def search_media(self, key):
        key = key.lower()
        response = {}

        for k, value in self.mapping.items():
            if not value['directory'] and key in value['name'].lower():
                response['{}'.format(value['id'])] = 1

        return response


    def save_rescan_diff(self, filehash, deleted):
        self.listDiffs.append(ListHistory(int(time.time()), filehash, deleted))

    def latest_rescan_diff(self):
        if len(self.listDiffs) < 1: return 0
        return self.listDiffs[-1].date

    def get_rescan_diffs(self, lastUpdate):
        #return a list of all diffs after last update
        diffList = []
        for diff in self.listDiffs:
            if diff.date > lastUpdate:
                diffList.append(diff)

        return diffList
        
'''
Program Entry
'''

@app.route('/api/commands/rescan')
def rescanner():
    lastUpdate = request.args.get('lastUpdate')
    if lastUpdate is None:
        lastUpdate = 0
    else:
        lastUpdate = int(lastUpdate)

    root_dir = GLOBAL_SETTINGS['ImageListClass'].root
    updated = GLOBAL_SETTINGS['ImageListClass'].latest_rescan_diff()
    resp = {'more': False, 'time': updated, 'added': [], 'removed': []}
    if lastUpdate >= updated:
        #if the last update time matches both the client and the server
        #check for new files on the server to push
        #otherwise, we just need to sync the client up with the server
        oldHash = GLOBAL_SETTINGS['MusicListClass'].fileHash
        RescanHash = FileHashNodeTree(root_dir)
        RescanHash.scan_directory(root_dir, '.', '.', oldHash)
        RescanHash.resolve_scan_diff(root_dir, '.', '.', oldHash)
        #merge the new files added back into the original file tree
        resp['added'] = RescanHash.get_files()
        resp['removed'] = oldHash.merge_scan_diff(RescanHash)
        GLOBAL_SETTINGS['ImageListClass'].save_rescan_diff(RescanHash, resp['removed'])
        resp['time'] = GLOBAL_SETTINGS['ImageListClass'].latest_rescan_diff()
    else:
        diffsList = GLOBAL_SETTINGS['ImageListClass'].get_rescan_diffs(lastUpdate)
        combinedDiffs = diffsList.pop(0)
        resp['removed'] = combinedDiffs.deleted
        resp['time'] = combinedDiffs.date
        resp['more'] = resp['time'] <= updated;
        resp['added'] = combinedDiffs.filehashnode.get_files()

    return jsonify(**resp)


@app.route('/api/files')
def files():
    obj = {
        'root' : GLOBAL_SETTINGS['image-dir'],
        'files': GLOBAL_SETTINGS['ImageListClass'].fileHash.get_files(),
        'count': len(GLOBAL_SETTINGS['ImageListClass'].mapping.keys())
    }
    return jsonify(**obj)


@app.route('/api/files/search/<string:keyword>')
def search(keyword):
    keyword = keyword.strip()
    if len(keyword) <= 0:
        return '', 400

    return jsonify(**GLOBAL_SETTINGS["ImageListClass"].search_media(keyword))


@app.route('/api/files/<string:identifier>')
def file(identifier):
    file = GLOBAL_SETTINGS['ImageListClass'].get_file(identifier)
    if not file:
        return '', 400
    return jsonify(**file)

@app.route('/<path:filename>')
def serving(filename):
    # for whatever isn't an audio file
    return send_file(filename)

@app.route('/')
def togui():
    return redirect(url_for('index'))

@app.route('/gui')
def index():
    return render_template('index.html')

def args():
    # get port number
    try:
        idx = sys.argv.index('-p')
        if idx + 1 < len(sys.argv):
            GLOBAL_SETTINGS['server-port'] = sys.argv[idx + 1]
        else:
            logging.error("Missing port value!")
            exit(1)
    except:
        logging.info("Using default port: {}".format(
            GLOBAL_SETTINGS['server-port']))

    GLOBAL_SETTINGS['image-dir'] = sys.argv[-1]


def main():
    args()
    GLOBAL_SETTINGS['ImageListClass'] = ImageList(GLOBAL_SETTINGS['image-dir'])
    GLOBAL_SETTINGS['running-dir'] = os.path.dirname(os.path.realpath(__file__))

    try:
        os.stat(GLOBAL_SETTINGS["cache-dir"])
    except:
        os.mkdir(GLOBAL_SETTINGS["cache-dir"])

    app.run(host='0.0.0.0', threaded=True, port=GLOBAL_SETTINGS['server-port'])

if __name__ == '__main__':
    main()
