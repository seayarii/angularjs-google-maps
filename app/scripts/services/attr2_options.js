/**
 * @ngdoc service
 * @name Attr2Options
 * @description 
 *   Converts tag attributes to options used by google api v3 objects, map, marker, polygon, circle, etc.
 */
ngMap.services.Attr2Options = function($parse) { 
  var SPECIAL_CHARS_REGEXP = /([\:\-\_]+(.))/g;
  var MOZ_HACK_REGEXP = /^moz([A-Z])/;  

  function camelCase(name) {
    return name.
      replace(SPECIAL_CHARS_REGEXP, function(_, separator, letter, offset) {
        return offset ? letter.toUpperCase() : letter;
      }).
      replace(MOZ_HACK_REGEXP, 'Moz$1');
  }

  var toOptionValue = function(input, options) {
    var output, key=options.key, scope=options.scope;
    try { // 1. Number?
      var num = Number(input);
      if (isNaN(num)) {
        throw "Not a number";
      } else  {
        output = num;
      }
    } catch(err) { 
      try { // 2.JSON?
        output = JSON.parse(input);
      } catch(err2) {
        // 3. Object Expression. i.e. LatLng(80,-49)
        if (input.match(/^[A-Z][a-zA-Z0-9]+\(.*\)$/)) {
          try {
            var exp = "new google.maps."+input;
            output = eval(exp); // TODO, still eval
          } catch(e) {
            output = input;
          } 
        // 4. Object Expression. i.e. MayTypeId.HYBRID 
        } else if (input.match(/^[A-Z][a-zA-Z0-9]+\.[A-Z]+$/)) {
          try {
            output = scope.$eval("google.maps."+input);
          } catch(e) {
            output = input;
          } 
        // 5. Object Expression. i.e. HYBRID 
        } else if (input.match(/^[A-Z]+$/)) {
          try {
            var capitializedKey = key.charAt(0).toUpperCase() + key.slice(1);
            output = scope.$eval("google.maps."+capitializedKey+"."+input);
          } catch(e) {
            output = input;
          } 
        } else {
          output = input;
        }
      } // catch(err2)
    } // catch(err)
    return output;
  };

  return {
    /**
     * filters attributes by skipping angularjs methods $.. $$..
     * @memberof Attr2Options
     * @param {Hash} attrs tag attributes
     * @returns {Hash} filterd attributes
     */
    filter: function(attrs) {
      var options = {};
      for(var key in attrs) {
        if (!key.match(/^\$/)) {
          options[key] = attrs[key];
        }
      }
      return options;
    },


    /**
     * converts attributes hash to Google Maps API v3 options  
     * ```
     *  . converts numbers to number   
     *  . converts class-like string to google maps instance   
     *    i.e. `LatLng(1,1)` to `new google.maps.LatLng(1,1)`  
     *  . converts constant-like string to google maps constant    
     *    i.e. `MapTypeId.HYBRID` to `google.maps.MapTypeId.HYBRID`   
     *    i.e. `HYBRID"` to `google.maps.MapTypeId.HYBRID`  
     * ```
     * @memberof Attr2Options
     * @param {Hash} attrs tag attributes
     * @param {scope} scope angularjs scope
     * @returns {Hash} options converted attributess
     */
    getOptions: function(attrs, scope) {
      var options = {};
      for(var key in attrs) {
        if (attrs[key]) {
          if (key.match(/^on[A-Z]/)) { //skip events, i.e. on-click
            continue;
          } else if (key.match(/ControlOptions$/)) { // skip controlOptions
            continue;
          } else {
            options[key] = toOptionValue(attrs[key], {scope:scope, key: key});
          }
        } // if (attrs[key])
      } // for(var key in attrs)
      return options;
    },

    /**
     * converts attributes hash to scope-specific event function 
     * @memberof Attr2Options
     * @param {scope} scope angularjs scope
     * @param {Hash} attrs tag attributes
     * @returns {Hash} events converted events
     */
    getEvents: function(scope, attrs) {
      var events = {};
      var toLowercaseFunc = function($1){
        return "_"+$1.toLowerCase();
      };
      var eventFunc = function(attrValue) {
        var matches = attrValue.match(/([^\(]+)\(([^\)]*)\)/);
        var funcName = matches[1];
        var argsStr = matches[2].replace(/event[ ,]*/,'');  //remove string 'event'
        
        var args = scope.$eval("["+argsStr+"]");
        return function(event) {
          scope[funcName].apply(this, [event].concat(args));
        }
      }

      for(var key in attrs) {
        if (attrs[key]) {
          if (!key.match(/^on[A-Z]/)) { //skip if not events
            continue;
          }
          
          //get event name as underscored. i.e. zoom_changed
          var eventName = key.replace(/^on/,'');
          eventName = eventName.charAt(0).toLowerCase() + eventName.slice(1);
          eventName = eventName.replace(/([A-Z])/g, toLowercaseFunc);

          var attrValue = attrs[key];
          events[eventName] = new eventFunc(attrValue);
        }
      }
      return events;
    },

    /**
     * control means map controls, i.e streetview, pan, etc, not a general control
     * @memberof Attr2Options
     * @param {Hash} filtered filtered tag attributes
     * @returns {Hash} Google Map options
     */
    getControlOptions: function(filtered) {
      var controlOptions = {};
      if (typeof filtered != 'object')
        return false;

      for (var attr in filtered) {
        if (filtered[attr]) {
          if (!attr.match(/(.*)ControlOptions$/)) { 
            continue; // if not controlOptions, skip it
          }

          //change invalid json to valid one, i.e. {foo:1} to {"foo": 1}
          var orgValue = filtered[attr];
          var newValue = orgValue.replace(/'/g, '"');
          newValue = newValue.replace(/([^"]+)|("[^"]+")/g, function($0, $1, $2) {
            if ($1) {
              return $1.replace(/([a-zA-Z0-9]+?):/g, '"$1":');
            } else {
              return $2; 
            } 
          });
          try {
            var options = JSON.parse(newValue);
            for (var key in options) { //assign the right values
              if (options[key]) {
                var value = options[key];
                if (typeof value === 'string') {
                  value = value.toUpperCase();
                } else if (key === "mapTypeIds") {
                  value = value.map( function(str) {
                    return google.maps.MapTypeId[str.toUpperCase()];
                  });
                } 
                
                if (key === "style") {
                  var str = attr.charAt(0).toUpperCase() + attr.slice(1);
                  var objName = str.replace(/Options$/,'')+"Style";
                  options[key] = google.maps[objName][value];
                } else if (key === "position") {
                  options[key] = google.maps.ControlPosition[value];
                } else {
                  options[key] = value;
                }
              }
            }
            controlOptions[attr] = options;
          } catch (e) {
            console.error('invald option for', attr, newValue, e, e.stack);
          }
        }
      } // for

      return controlOptions;
    }, // function

    getAttrsToObserve : function(elem) {
      var attrs = elem[0].attributes;
      //console.log('attrs', attrs);
      var attrsToObserve = [];
      for (var i=0; i<attrs.length; i++) {
        var attr = attrs[i];
        //console.log('attr', attr.name, attr.value);
        if (attr.value && attr.value.match(/{{.*}}/)) {
          attrsToObserve.push(camelCase(attr.name));
        }
      }
      return attrsToObserve;
    }

  }; // return
}; // function

