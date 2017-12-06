var injected = injected || (function() {

  var Interaction = {
    hover: 'hover',
    select: 'select'
  };

  var Color = {
    hover: {
      padding: 'rgba(158,113,221,0.5)',
      content: 'rgba(73,187,231,0.25)',
      box: 'rgba(13, 139, 201, 0.45)',
    },
    select: {
      padding: 'rgba(234, 155, 123, 0.5)',
      content: 'rgba(224, 0, 0, 0.25)',
      box: 'rgba(179, 0, 0, 0.45)',
    }
  };
  
  var Util = {
    getBox: function(target) {
      var box, computedStyle, rect;
      rect = target.getBoundingClientRect();
      computedStyle = window.getComputedStyle(target);
      box = {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
          margin: {
              top: computedStyle.marginTop,
              right: computedStyle.marginRight,
              bottom: computedStyle.marginBottom,
              left: computedStyle.marginLeft
          },
          padding: {
              top: computedStyle.paddingTop,
              right: computedStyle.paddingRight,
              bottom: computedStyle.paddingBottom,
              left: computedStyle.paddingLeft
          }
      };

      // pluck negatives
      ['margin', 'padding'].forEach(function(property) {
          for (var el in box[property]) {
              var val = parseInt(box[property][el], 10);
              box[property][el] = Math.max(0, val);
          }
      });

      box.left = Math.floor(box.left) + 1.5;
      box.width = Math.floor(box.width) - 1;

      return box;
    },
    tracePath: function (element, result) {
      if (element.id !== '') {
        result.push({
          id: element.id
        });
        return;
      }
      if (element === document.body) {
        result.push({
          tag: element.tagName
        });
        return;
      }

      var siblings = element.parentNode.childNodes;
      for (var i = 0; i < siblings.length; ++i) {
        var sibling = siblings[i];
        if (sibling === element) {
          result.push({
            index: i,
            tag: element.tagName
          });
          return this.tracePath(element.parentNode, result);
        }
      }
    },
    find: function (path) {
      var element;
      while (path.length) {
        var current = path.pop();

        if (!current) return element;
        if (current.id) element = document.getElementById(current.id);
        else if (element) {
          if (current.index < element.childNodes.length && current.tag === element.childNodes[current.index].tagName)
            element = element.childNodes[current.index];
          else
            return;
        } else {
          var matches = document.getElementsByTagName(current.tag);
          if (matches.length)
              element = matches[0];
        }
      }
      return element;
    },
    store: function (path) {
      var selection = Object.create({});
      selection[window.location.href] = path;
      chrome.storage.local.set(selection, function () {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError)
        }
      })
    },
    load: function () {
      var self = this, key = window.location.href;
      chrome.storage.local.get(key, function (found) {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError)
        } else if (found && found[key]) {
          var path = found[key],
            element = Util.find(path);

          if (element) {
            // zoom into inspected element
            element.scrollIntoView();
            // add selection to Inspector instance
            self.$selection = element;
            // function similar to layout() - highlights inspected element
            self.select();
          }
        }
      })
    }
  };

  // Inspector constructor
  var Inspector = function() {
    this.highlight = this.highlight.bind(this);
    this.log = this.log.bind(this);
    this.codeOutput = this.codeOutput.bind(this);
    this.layout = this.layout.bind(this);
    this.select = this.select.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.loadSelection = Util.load.bind(this);
    this.storeSelection = Util.store.bind(this);

    this.$target = document.body;
    this.$cacheEl = document.body;
    this.$cacheElMain = document.body;

    this.serializer = new XMLSerializer();
    this.forbidden = [this.$cacheEl, document.body, document.documentElement];
  };

  Inspector.prototype = {

    getNodes: function() {
      var path = chrome.extension.getURL("template.html");

      var xmlhttp = new XMLHttpRequest();

      xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState === 4 && xmlhttp.status === 200) {
          this.template = xmlhttp.responseText;
          this.createNodes();
          this.registerEvents();
        }
      }.bind(this);

      xmlhttp.open("GET", path, true);
      xmlhttp.send();
    },

    createNodes: function() {
      this.$host = document.createElement('div');
      this.$host.className = 'tl-host';
      this.$host.style.cssText = 'all: initial;';

      var shadow = this.$host.createShadowRoot();
      document.body.appendChild(this.$host);

      var templateMarkup = document.createElement("div");
      templateMarkup.innerHTML = this.template;
      shadow.innerHTML = templateMarkup.querySelector('template').innerHTML;

      this.$wrap = shadow.querySelector('.tl-wrap');
      this.$code = shadow.querySelector('.tl-code');

      this.$canvas = shadow.querySelector('#tl-canvas');
      this.c = this.$canvas.getContext('2d');
      this.width = this.$canvas.width = window.innerWidth;
      this.height = this.$canvas.height = window.innerHeight;

      this.highlight();
    },

    registerEvents: function() {
      document.addEventListener('mousemove', this.log);
      document.addEventListener('scroll', function () {
          this.layout();
          this.select();
      }.bind(this));
      document.addEventListener('click', function () {
          var path = [];
          Util.tracePath(this.$target, path);
          this.$selection = this.$target;
          this.select(true);
          this.storeSelection(path);
      }.bind(this));
      window.addEventListener('resize', function(){
        this.handleResize();
        this.layout();
      }.bind(this));
    },

    log: function(e) {
      this.$target = e.target;

      // check if element cached
      if (this.forbidden.indexOf(this.$target) !== -1) return;

      this.stringified = this.serializer.serializeToString(this.$target);

      this.codeOutput();

      this.$cacheEl = this.$target;
      this.layout();
      if (this.$selection)
        this.select();
    },

    codeOutput: function() {
      if (this.$cacheElMain === this.$target) return;
      this.$cacheElMain = this.$target;

      var fullCode = this.stringified
        .slice(0, this.stringified.indexOf('>') + 1)
        .replace(/ xmlns="[^"]*"/, '');

      this.$code.innerText = fullCode; // set full element code
      this.highlight(); // highlight element
    },

    // redraw overlay
    layout: function() {
      var box = Util.getBox(this.$target);
      var c = this.c;

      c.clearRect(0, 0, this.width, this.height);

      var x, y, width, height;

      // margin
      x = box.left - box.margin.left;
      y = box.top - box.margin.top;
      width = box.width + box.margin.left + box.margin.right;
      height = box.height + box.margin.top + box.margin.bottom;

      c.fillStyle = 'rgba(255,165,0,0.5)';
      c.fillRect(x, y, width, height);

      // padding
      x = box.left;
      y = box.top;
      width = box.width;
      height = box.height;

      c.fillStyle = Color[Interaction.hover].padding;
      c.clearRect(x, y, width, height);
      c.fillRect(x, y, width, height);

      // content
      x = box.left + box.padding.left;
      y = box.top + box.padding.top;
      width = box.width - box.padding.right - box.padding.left;
      height = box.height - box.padding.bottom - box.padding.top;

      c.fillStyle = Color[Interaction.hover].content;
      c.clearRect(x, y, width, height);
      c.fillRect(x, y, width, height);

      // rulers (horizontal - =)
      x = -10;
      y = Math.floor(box.top) + 0.5;
      width = this.width + 10;
      height = box.height - 1;

      c.beginPath();
      c.setLineDash([10,3]);
      c.fillStyle = 'rgba(0,0,0,0.02)';
      c.strokeStyle = Color[Interaction.hover].box;
      c.lineWidth = 1;
      c.rect(x, y, width, height);
      c.stroke();
      c.fill();

      // rulers (vertical - ||)
      x = box.left;
      y = -10;
      width = box.width;
      height = this.height + 10;

      c.beginPath();
      c.setLineDash([10,3]);
      c.fillStyle = 'rgba(0,0,0,0.02)';
      c.strokeStyle = Color[Interaction.hover].box;
      c.lineWidth = 1;
      c.rect(x, y, width, height);
      c.stroke();
      c.fill();
    },

    select: function(clear) {
      var box = Util.getBox(this.$selection);
      var c = this.c;

      if (clear)
        c.clearRect(0, 0, this.width, this.height);

      var x, y, width, height;

      // margin
      x = box.left - box.margin.left;
      y = box.top - box.margin.top;
      width = box.width + box.margin.left + box.margin.right;
      height = box.height + box.margin.top + box.margin.bottom;

      c.fillStyle = 'rgba(255,165,0,0.5)';
      c.fillRect(x, y, width, height);

      // padding
      x = box.left;
      y = box.top;
      width = box.width;
      height = box.height;

      c.fillStyle = Color[Interaction.select].padding;
      c.clearRect(x, y, width, height);
      c.fillRect(x, y, width, height);

      // content
      x = box.left + box.padding.left;
      y = box.top + box.padding.top;
      width = box.width - box.padding.right - box.padding.left;
      height = box.height - box.padding.bottom - box.padding.top;

      c.fillStyle = Color[Interaction.select].content;
      c.clearRect(x, y, width, height);
      c.fillRect(x, y, width, height);

      x = box.left;
      y = Math.floor(box.top) + 0.5;
      height = box.height - 1;
      width = box.width;

      c.beginPath();
      c.setLineDash([]);
      c.fillStyle = 'rgba(0,0,0,0.02)';
      c.strokeStyle = Color[Interaction.select].box;
      c.lineWidth = 2;
      c.rect(x, y, width, height);
      c.stroke();
      c.fill();
    },

    handleResize: function() {
      this.width = this.$canvas.width = window.innerWidth;
      this.height = this.$canvas.height = window.innerHeight;
    },

    // code highlighting
    highlight: function() {
      Prism.highlightElement(this.$code);
    },

    activate: function() {
      // this.loadSelection();
      this.getNodes();
      this.loadSelection();
    },

    deactivate: function() {
      this.$wrap.classList.add('-out');
      document.removeEventListener('mousemove', this.log);
      setTimeout(function() {
        document.body.removeChild(this.$host);
      }.bind(this), 600);
    }
  };

  var hi = new Inspector();

  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'activate') {
      hi.tab = request.tab;
      return hi.activate();
    } else {
      return hi.deactivate();
    }
  });

  return true;
})();
