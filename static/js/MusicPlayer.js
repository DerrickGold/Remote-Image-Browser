ImageLibrary = function(evtSys) {
  this.mediaDir = null;
  this.mediaHash = {};
  this.indentSize = 10;
  this.evtSys = evtSys;
  this.curImageInfo = null;
  this.shuffle = false;
  this.playHist = [];
  this.navbarOffset = "";
  this.init();
  this.lastUpdate = 0;
  this.randomRecursDepth = 32;
}

ImageLibrary.prototype.hashToEntry = function (hash) {
  return this.mediaHash[hash];
}

ImageLibrary.prototype.triggerLoading = function () {
  this.evtSys.dispatchEvent(new Event("loading"));
}

ImageLibrary.prototype.triggerLoadingDone = function () {
  this.evtSys.dispatchEvent(new Event("loading done"));
}

ImageLibrary.prototype.triggerNewState = function () {
  var ev = new Event('media state change');
  ev.playbackState = this.playbackState;
  this.evtSys.dispatchEvent(ev);
}

ImageLibrary.prototype.encodeURI = function(uriIn) {
  return encodeURI(uriIn).replace(/\(/g, "%28").replace(/\)/g, "%29");
}

ImageLibrary.prototype.getFolderCollapseId = function(directoryID) {
  return "collapse-" + directoryID;
}

ImageLibrary.prototype.getFilePath = function(file) {
  var curFile = file;
  var output = file.name;
  while (curFile.parent != ".") {
    var parent = this.mediaHash[curFile.parent];
    if (parent.name === ".") break;
    output = parent.name + '/' + output;
    curFile = parent;
  }
  return this.mediaDir.root + '/' + output;
}

ImageLibrary.prototype.getRandomImage = function(r_count) {
  if (r_count != undefined && r_count != null) {
    if (r_count >= this.randomRecursDepth) return null;
  } else r_count = 1;

  var allFiles = Object.keys(this.mediaHash), index = -1;
  while (index < 0 || this.mediaHash[allFiles[index]].directory)
    index = Math.floor((Math.random() * 17435609119)) % allFiles.length;

  var curImage = this.mediaHash[allFiles[index]];
  var nodes = this.reverseImageHashLookup(curImage).reverse();
  for (var i = 0; i < nodes.length; i++) {
    curImage = this.mediaHash[nodes[i]];
    if (curImage._exclude === true) return this.getRandomImage(r_count + 1);
  }
  
  return curImage;
}

ImageLibrary.prototype.getRootDirDiv = function() {
  return document.getElementById("dirlist");
}

ImageLibrary.prototype.toggleNowPlaying = function(preventClose, forceClose) {
  var overlay = document.querySelector('[role="currently-playing"]');
  var content = document.querySelector('[role="content"]');
  var state   = (forceClose || (!preventClose && !overlay.classList.contains("inactive")))
  overlay.classList.toggle("inactive", state);
  content.classList.toggle("inactive", !state);
}

ImageLibrary.prototype.getFiles = function() {
  var self = this;
  this.triggerLoading()
  self._doneGet = false;
  this.apiCall("/api/files", "GET", true, function(resp) {
    self.mediaDir = JSON.parse(resp);
    self.displayFolder(self.mediaDir.files, self.getRootDirDiv(), 0, self.mediaDir.count, function(hash) {
      self.triggerLoadingDone();
      if (self.autoplay) {
        //get the user to touch the screen to gain control of the image player in mobile
        //browsers
        if (window.mobilecheck) {
          var msg = document.querySelector('[role="load-text"]');
          msg.classList.remove("hidden");
        }
        self.viewImage(self.hashToEntry(self.autoplay), 0);
        self.toggleNowPlaying();
      }
    });
  });
}

//ToDo: Fix this broken shiz
//Doesn't seem to remove entries from the hash, they still
//exist, but visually the nodes are removed
ImageLibrary.prototype.rmNode = function(node) {
  var self = this;
  if (!node) {
    console.log("No node found!\n");
    return;
  }

  var parent = self.mediaHash[node.parent];
  if (node.directory) {
    node.children.forEach(function(e) {
      self.rmNode(e)
    });
  }
  //update the parent node to remove the child entry
  for (var i = 0; i < parent.children.length; i++) {
    if (parent.children[i] === node.id) {
      parent.children.splice(i, 1);
      break;
    }
  }
  //remove the html element
  var nodeElm = document.getElementById(node.id);
  if (nodeElm) {
    console.log("Found node element");
    nodeElm.parentNode.removeChild(nodeElm);
    console.log(nodeElm);
  } else {
    console.log("Failed to find node element");
    console.log(node);
  }
  //remove element from the hash
  delete self.mediaHash[node.id];
}

ImageLibrary.prototype.nodeComparator = function(node1, node2) {
  if (node1.directory && !node2.directory) return -1;
  else if (!node1.directory && node2.directory) return 1;

  var name1 = node1.name.toLowerCase();
  var name2 = node2.name.toLowerCase();
  return name1.localeCompare(node2.name);
}

ImageLibrary.prototype.getInsertPos = function(parentNode, insertNode) {
  var targetHead = this.mediaHash[parentNode.id];
  var min = 0, max = targetHead.children.length - 1, mid = 0, order = 0;
  while (min <= max) {
    mid = parseInt((min + max) / 2);
    order = this.nodeComparator(insertNode, targetHead.children[mid]);
    if (order < 0) max = mid - 1;
    else if (order > 0) min = mid + 1;
    else break;
  }
  if (mid >= targetHead.children.length - 1) {
    console.log("MIN IS OVER ARRAY");
    return {node: null, pos: targetHead.children.length -1, o: order};
  }
  mid += (this.nodeComparator(insertNode, targetHead.children[mid]) > 0);
  return {node: targetHead.children[mid], pos: mid, o: order};
}

ImageLibrary.prototype.insertTree = function(dest, node, top) {
  var self = this, newTop = top, pDiv = null;
  console.log("Inserting: ");
  console.log(node);
  var parentDiv = null;
  if (dest.parent === '.')
    parentDiv = document.querySelector('[role="tablist"]');
  else
    parentDiv = document.getElementById(self.getFolderCollapseId(dest.id));
    
  if (node.directory) {
    if (!self.mediaHash[node.id]) {
      self.mediaHash[node.id] = node;
      
      var things = self.displayMakeFolder(node, false, 0);
      if (!newTop) {
        //we are taking our new tree and merging it with
        //the current file tree. Need to make sure its inserted
        //in sorted order
        //dest.children.push(node);
        newTop = true;
        var after = self.getInsertPos(dest, node);
        console.log("Inserting: ");
        console.log(after);
/*        if (after.node) {
          pDiv = document.getElementById(after.node.id);
          dest.children.splice(after.pos, 0, node);
        } else dest.children.push(node);
        parentDiv.insertBefore(things[0], pDiv);
*/
        pDiv = (after.node) ? document.getElementById(after.node.id) : null;
        dest.children.splice(after.pos, 0, node);
        parentDiv.insertBefore(things[0], pDiv);
      } else {
        //here we are just creating the html for the children nodes of the tree
        //we inserted, they should already be in sorted order from the tree diff
        parentDiv.appendChild(things[0]);
      }
    }    
    for (var i = 0; i < node.children.length; i++) {
//      if (self.mediaHash[node.children[i].id]) continue;
      self.insertTree(self.mediaHash[node.id], node.children[i], newTop);
    }
  } else {
    if (self.mediaHash[node.id]) return;
    //not a directory, but a file
    //TODO: cleanup this ugly implementation, I just wanna listen to some tunes now
    var after = self.getInsertPos(dest, node);
    pDiv = (after.node) ? document.getElementById(after.node.id) : null;
    self.mediaHash[node.id] = node;
    dest.children.splice(after.pos, 0, node);
    parentDiv.insertBefore(self.displayMakeFile(node, 0), pDiv);
  }
/*    if (after.node) {
      pDiv = document.getElementById(after.node.id);
      self.mediaHash[node.id] = node;
      dest.children.splice(after.pos, 0, node);
      parentDiv.insertBefore(self.displayMakeFile(node, 0), pDiv);
    } else {
      self.mediaHash[node.id] = node;
      dest.children.push(node);
      parentDiv.appendChild(self.displayMakeFile(node, 0));
    }
  }
*/
}

ImageLibrary.prototype.rescanFiles = function() {
  var self = this;
  var arg = self.lastUpdate !== null ? "?lastUpdate=" + self.lastUpdate : "";
  this.apiCall("/api/commands/rescan" + arg , "GET", true, function(resp) {
    var mediaDiff = JSON.parse(resp);
    console.log(mediaDiff);
    self.lastUpdate = mediaDiff.time;
    //remove files first, then add them
    for (var i = 0; i < mediaDiff["removed"].length; i++) {
      var id = mediaDiff["removed"][i];
      self.rmNode(self.mediaHash[id]);
    }
    var dest = self.mediaHash[mediaDiff["added"].id];
    self.insertTree(dest, mediaDiff["added"], false);
    if (mediaDiff['more'] === true) self.rescanFiles();
  });
}

ImageLibrary.prototype.setFolderView = function(node, view) {
  var toggler = node.querySelector('[role="button"]');
  var collapser = node.querySelector('[role="tabpanel"]');
  var state = view === 'open' ? true : false;
  toggler.setAttribute('aria-expanded', state);
  collapser.setAttribute('aria-expanded', state);
  collapser.classList.toggle('collapse', !state)
  if (state) collapser.style.height = null;
}

ImageLibrary.prototype.makeMediaLibHash = function(root) {
  var self = this;
  self.mediaHash[root.id] = root;
  if (!root.directory) return
  self.chunking(root.children, function(e) {
    self.makeMediaLibHash(e)
  });
}

ImageLibrary.prototype.apiCall = function(route, method, async, successCb, errorCb) {
  var xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
    if (xhttp.readyState == 4 && xhttp.status == 200)
      if (successCb) successCb(xhttp.responseText);
    else if (xhttp.readyState == 4)
      if (errorCb) errorCb(xhttp.responseText);
  }
  xhttp.open(method, route, async);
  xhttp.send();
}

ImageLibrary.prototype.reverseImageHashLookup = function(startNode) {
  var findStack = [], curNode = startNode;
  if (!curNode) return [];
  while(curNode.parent != ".") {
    findStack.push(curNode.id);
    curNode = this.mediaHash[curNode.parent]
  }
  findStack.push(curNode.id);
  return findStack;
}

ImageLibrary.prototype.closeDirectory = function(folderDiv) {
  if (folderDiv.classList && folderDiv.getAttribute('role') === "directory")
    return this.closeDirectory(folderDiv.parentNode);
  var x = folderDiv.querySelectorAll('[role="directory"]');
  for (var i = 0; i < x.length; i++) {
    x[i].classList.remove("hidden");
    this.setFolderView(x[i], "close");
  }
}

ImageLibrary.prototype.displayMakeExcludeButton = function(nodeID, container) {
  var self = this;
  var icon = document.createElement("span");
  icon.className = "fa fa-ban exclude-btn";
  icon.setAttribute("aria-hidden", "true");
  icon.onclick = function(e) {
    e.preventDefault();
    var aElm = container.querySelector('[role="button"]');
    var state = !self.mediaHash[nodeID]._exclude
    self.mediaHash[nodeID]._exclude = state;
    aElm.classList.toggle("disabled-folder", state);
    if (state) self.closeDirectory(container.parentNode);
  }
  return icon;
}

ImageLibrary.prototype.displayMakeFolder = function(folderEntry, expanded, depth) {
  var panelHeader       = document.createElement("div");
  panelHeader.className = "folder-heading";
  panelHeader.setAttribute("role", "tab");
  panelHeader.appendChild(this.displayMakeExcludeButton(folderEntry.id, panelHeader));

  var icon = document.createElement("span");
  icon.className = "fa fa-folder-o";
  icon.setAttribute("aria-hidden", "true");
  panelHeader.appendChild(icon);

  var collapseButton       = document.createElement("span");
  collapseButton.className = "folder-entry-name";
  collapseButton.setAttribute("role", "button");
  collapseButton.setAttribute("data-toggle", "collapse");
  collapseButton.setAttribute("href","#" + this.getFolderCollapseId(folderEntry.id));
  collapseButton.setAttribute("aria-expanded", expanded);
  collapseButton.setAttribute("aria-controls", this.getFolderCollapseId(folderEntry.id));
  collapseButton.appendChild(document.createTextNode(folderEntry.name));
  panelHeader.appendChild(collapseButton);

  var panel       = document.createElement("div");
  panel.id        = folderEntry.id;
  panel.className = "folder-entry";
  panel.setAttribute("role", "directory");
  panel.appendChild(panelHeader);

  var bodyCollapse = document.createElement("div");
  bodyCollapse.id = this.getFolderCollapseId(folderEntry.id);
  bodyCollapse.className = "panel-collapse collapse folder-body";
  bodyCollapse.setAttribute("role", "tabpanel");
  panel.appendChild(bodyCollapse);

  collapseButton.onclick = function (e) {
    bodyCollapse.classList.toggle('collapse');
  };

  return [panel, bodyCollapse];
}

ImageLibrary.prototype.displayMakeFile = function(fileEntry, depth) {
  var text       = document.createElement("div");
  text.id        = fileEntry.id;
  text.className = "file-entry folder-heading file-entry-name";
  text.setAttribute("role", "button image-file");
  text.appendChild(document.createTextNode(fileEntry.name));
  var self = this;
  text.onclick = function(e) {
    e.preventDefault();
    self.viewImage(fileEntry, 0);
  }
  return text;
}

ImageLibrary.prototype.displayFolder = function(folder, parentDiv, depth, count, donecb) {
  var self = this;
  if (depth == 0) self._processed = 0;
  self.mediaHash[folder.id] = folder;
  this.chunking(folder.children, function(f) {
    self._processed++;
    if (f.directory) {
      var things = self.displayMakeFolder(f, false, depth);
      parentDiv.appendChild(things[0]);
      self.displayFolder(f, things[1], depth + 1, count, donecb);
    } else {
      self.mediaHash[f.id] = f;
      parentDiv.appendChild(self.displayMakeFile(f, depth));
    }
  }, function() {
    if (self._processed >= count - 1 && donecb) {
      self._processed = -1;
      donecb(self.mediaHash);
    }
  });
}

ImageLibrary.prototype.openFileDisplayToImage = function(track) {
  if (track === undefined) track = this.curImageInfo;
  //first check if item is not already in viewport before scrolling
  var trackDiv = document.getElementById(track.id);
  var inView = false;
  if (trackDiv) {
    var trackDivBox = trackDiv.getBoundingClientRect();
    inView = (trackDivBox.top >= 0 && trackDivBox.left >= 0 &&
              trackDivBox.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
              trackDivBox.right <= (window.innerWidth || document.documentElement.clientWidth));
    //check if folder is open too
    var trackFolder = document.getElementById(this.getFolderCollapseId(track.parent));
    if (trackFolder) inView = (inView && trackFolder.classList.contains("in"));
  }
  var nodes = this.reverseImageHashLookup(track).reverse();
  var lastDiv = null;
  var self = this, lastDiv = null;
  this.chunking(nodes, function(curNode) {
    var id = curNode;
    if (self.mediaHash[id].parent == ".") return;
    if (self.mediaHash[id].directory) {
      lastDiv = document.getElementById(id);
      if (!lastDiv) return;
      self.setFolderView(lastDiv, "open");
    } else
      lastDiv = document.getElementById(id);
  }, function() {
    if (inView || !lastDiv) return;
    lastDiv.scrollIntoView(true);
    window.scrollBy(0, -self.navbarOffset);
  });
}

ImageLibrary.prototype.chunking = function(library, cb, donecb) {
  var perFrame = 500, idx = 0, lib = library, fps = 60;
  var time = 1000/fps;
  function doChunk() {
    setTimeout(function() {
      var liblen = lib.length;
      if (idx >= liblen) {
        if (donecb) donecb();
        return;
      }
      for (var x = 0; x < perFrame; x++) {
        if (idx + x >= liblen) break;
        if (cb) cb(lib[idx + x]);
      }
      idx += perFrame;
      window.requestAnimationFrame(doChunk);
    }, time);
  }
  window.requestAnimationFrame(doChunk);
}

ImageLibrary.prototype.showSearch = function(keyword) {
  var self = this;
  keyword = keyword.replace(/^s+|\s+$/g, '');
  //keyword = keyword.replace(' ', '%20');
  keyword = self.encodeURI(keyword)
  if (keyword.length <= 0) return;
  this.toggleNowPlaying(false, true);
  this.triggerLoading()
  this.apiCall("/api/files/search/" + keyword, "GET", true, function(resp) {
    var data = JSON.parse(resp);
    var everything = document.querySelectorAll('[role*="image-file"],[role="directory"]');
    self.chunking(everything, function(d) {
      var id = d.id;
      if (id in data) {
        if (d.classList.contains("hidden")) d.classList.remove("hidden");
        if (d.getAttribute('role') === 'directory') return;
        else {
          var nodes = self.reverseImageHashLookup(self.mediaHash[id]);
          var skipEntry = false;
          var checkExcluded = nodes.slice(0).reverse();
          while (checkExcluded.length > 0) {
            var id = checkExcluded.pop();
            if (self.mediaHash[id]._exclude) {
              skipEntry = true;
              delete data[id];
              break;
            }
          }
          if (skipEntry) return;
          while(nodes.length > 0) {
            var nodeID = nodes.pop();
            var hash   = self.mediaHash[nodeID];
            if (hash.parent == ".") continue;
            data[nodeID] = 1;
            var div = document.getElementById(nodeID);
            if (hash.directory) self.setFolderView(div, "open");
            div.classList.remove("hidden");
          }
        }
      } else if (!d.classList.contains("hidden"))
        d.classList.add("hidden");
    }, function() {
      self.triggerLoadingDone()
    });
  }, function(resp) {
    self.triggerLoadingDone()
  });
}

ImageLibrary.prototype.showFiles = function(show, donecb) {
  var apply = function(el) {
    el.classList.toggle('hidden', !show);
  }
  var x = document.querySelectorAll('[role*="image-file"],[role="directory"]');
  this.chunking(Array.prototype.slice.call(x), apply, donecb);
}

ImageLibrary.prototype.clearSearch = function(keyword) {
  this.showFiles(true);
}

ImageLibrary.prototype.updatePlayingEntry = function(entry, isPlaying) {
  if (!entry) return;
  console.log(entry);
  var song = document.getElementById(entry.id);
  song.classList.toggle('playing-entry', isPlaying);

  var shareBtn = null;
  var urlBox = null;
  if (!isPlaying) {
    //shareBtn = document.querySelector('[role="share"]');
    shareBtn = song.querySelector('[role="share"]');
    if (shareBtn) song.removeChild(shareBtn);
    urlBox = song.querySelector('[role="share-url"]');
    if (urlBox) song.removeChild(urlBox);
  } else {
    shareBtn = document.createElement('a');
    shareBtn.innerHTML = "share";
    shareBtn.setAttribute("href", "#");
    shareBtn.setAttribute("role", "share");
    urlBox = document.createElement('p');
    urlBox.setAttribute("role", "share-url");
    urlBox.innerHTML = window.location.href.match(".+/")
      + "gui?stream=true&autoplay=" + entry.id;
    shareBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (urlBox) CopyToClipboard(urlBox);
    };
    song.appendChild(shareBtn);
    if (urlBox) song.appendChild(urlBox);
  }
}

ImageLibrary.prototype.viewImage = function(songEntry, offset) {
  if (songEntry === null || songEntry === undefined) {
    alert("No available songs in play list to play!");
    return;
  }
//  this.triggerLoading()
  if (this.curImageInfo) this.playHist.push(this.curImageInfo);
  this.updatePlayingEntry(this.curImageInfo, false);
  this.curImageInfo = songEntry;
  this.updatePlayingEntry(this.curImageInfo, true);
  var path = this.getFilePath(this.curImageInfo);
  effect('[role="album-cover"]', function (el) {
    el.style.backgroundColor = "black";
  });
  effect('[role="background-cover"]', function (el) {
      el.style.backgroundImage = 'url("' + path + '")';
  });
  
  this.toggleNowPlaying(true, false);
  
}

ImageLibrary.prototype.nextImage = function() {
  if (this.shuffle) {
    this.viewImage(this.getRandomImage(), 0);
    return;
  }
  if (!this.curImageInfo) return;
  var nodes = this.reverseImageHashLookup(this.curImageInfo).reverse();
  var lastDir = this.curImageInfo.id;
  while (nodes.length > 0) {
    var popped = nodes.pop();
    var directory = this.mediaHash[popped];
    //if we popped off the current track, ignore it for now
    if (!directory.directory) continue;
    //look for the last directory or file visited to get position in directory
    //to coninue from
    var found = false;
    var position = 0;
    for(; position < directory.children.length; position++) {
      if (directory.children[position].id == lastDir) {
        found = true;
        break;
      }
    }
    if (found) position++;
    else position = 0;
    while (position < directory.children.length && directory.children[position]._exclude)
      position++;

    //if we hit the end of the folder, continue up the next level
    if (position >= directory.children.length) {
      lastDir = directory.id;
      continue;
    }
    var nextImage = directory.children[position];
    while (nextImage.directory) nextImage = nextImage.children[0];
    //otherwise, play the next song
    this.viewImage(nextImage, 0);
    break;
  }
}

ImageLibrary.prototype.prevImage = function() {
  if (this.playHist.length < 1) return;
  //purge the current song content since the next song
  //after the previous will be randomly selected
  this.updatePlayingEntry(this.curImageInfo, false);
  this.curImageInfo = null;
  var lastImage = this.playHist.pop();
  this.viewImage(lastImage, 0);
}

ImageLibrary.prototype.updateImageInfo = function(doneCb) {
  var self = this;
  document.getElementById("curinfo-path").innerHTML = this.getFilePath(this.curImageInfo);
  this.apiCall("/api/files/"+ this.curImageInfo.id + "/data", "GET", true, function(resp) {
    var data = JSON.parse(resp),
        infoStr = '',
        title = data.title.length > 0 ? data.title : self.curImageInfo.name;

    document.getElementById("curinfo-track").innerHTML = title;
    document.title = title;
    infoStr  = data.artist ? data.artist : '';
    infoStr += data.album ? (infoStr ? " &mdash; " + data.album : data.album) : '';
    document.getElementById("curinfo-artist").innerHTML = infoStr;
    document.getElementById("curinfo-totaltime").innerHTML = self.secondsToMinutesStr(data["length"]);
    if (doneCb) doneCb(data);
  });

}

ImageLibrary.prototype.init = function() {
  var self = this;
  this.getFiles();
  react('[role="open-location"]', 'click', function (ev) {
    ev.preventDefault();
    self.openFileDisplayToImage(self.curImageInfo);
    self.toggleNowPlaying(false, true);
  });
  /*document.querySelector('[role="album-art"]').onclick = function() {
    document.getElementById("curinfo-path").classList.toggle("hidden");
  }*/

  //var nowPlaying = document.querySelector('[role="currently-playing"]');
  //nowPlaying.addEventListener("mousewheel", function(e) { e.preventDefault(); e.stopPropagation(); }, false);
  //nowPlaying.addEventListener("DOMMouseScroll", function(e) { e.preventDefault(); e.stopPropagation(); }, false);
  document.getElementById("search-txt").addEventListener("keypress", function(e) { e.stopPropagation(); });
}
