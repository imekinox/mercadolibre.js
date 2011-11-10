;
(function(cookie, XAuth) {

    var Store = function() {
        this.map = {};

        return this;
    };

    Store.localStorageAvailable = (function() {
        try {
            return ('localStorage' in window) && window.localStorage !== null;
        } catch (e) {
            return false;
        }
    })();

    if (Store.localStorageAvailable) {
        Store.prototype.get = function(key) {
            return window.localStorage.getItem(key);
        };

        Store.prototype.set = function(key, value) {
            window.localStorage.setItem(key, value);
        };

    } else {
        Store.prototype.get = function(key) {
            return this.map[key];
        };

        Store.prototype.set = function(key, value) {
            this.map[key] = value;
        };

    }

    var Sroc = window.Sroc;

    var MercadoLibre = {
        baseURL : "https://api.mercadolibre.com",
        authorizationURL : "http://auth.mercadolibre.com/authorization",
        AUTHORIZATION_STATE : "authorization_state",

        hash : {},
        callbacks : {},
        store : new Store(),
        appInfo : null,
        isAuthorizationStateAvaible : false,
        authorizationState: {},
        authorizationStateAvailableCallbacks : [],
        authorizationStateCallbackInProgress : false,
        synchronizationInProgress : false,
 
        init : function(options) {
            this.options = options;

            if (this.options.sandbox) {
                this.baseURL = this.baseURL.replace(/api\./, "sandbox.");
            }
            //No credentials needed on initialization. Just on-demand retrieval
        },
        _isExpired: function(authState) {
          //credentials are expired if not present or expired
          //for Meli there is a special case when credentials are only-identification. In that case are always expired
          if (authState == null) {
            return true;
          }
          if (authState.authorization_credential.onlyID)  {
            return true;
          }
          var expirationTime = authState.authorization_credential.expires_in;
          if (expirationTime) {
            var dateToExpire = new Date(parseInt(expirationTime));
            var now = new Date();
            if (dateToExpire <= now) {
              return true;
            }
          }
          return false;
        },
        _synchronizeAuthorizationState:function(){
          //Synchronizes with iFrame in static.mlstatic.com domain.

          var key = this.options.client_id + this.AUTHORIZATION_STATE;
          var obj = this;

          //retrieves data from remote localStorage
          obj._retrieveFromXStore( obj.options.client_id + obj.AUTHORIZATION_STATE, function(value) {
            var key = obj.options.client_id + obj.AUTHORIZATION_STATE;
            if (value.tokens[key] == null || obj._isExpired(value.tokens[key].data)) {
              //no data from iFrame - call login_status api
              obj._getRemoteAuthorizationState();
            } else {
              //save authState in local variable
              var authState = value.tokens[key].data;
              authState.expiration = value.tokens[key].expire;
              obj.authorizationState[key] = authState;
              obj._onAuthorizationStateAvailable(authState);
            }
          });
        },

        _retrieveFromXStore : function(key, retrieveCallback) {
            XAuth.retrieve({
                retrieve : [ key ],
                callback : retrieveCallback
            });
        },

        _getRemoteAuthorizationState : function() {
          //gets authorization state from api (https)
          //if already in progress dismiss call and wait
          if (!this.authorizationStateCallbackInProgress) {
            this.authorizationStateCallbackInProgress = true;
            if (this.appInfo == null) {
                this._getApplicationInfo(); //this will call _internalGetRemoteAuthorizationState TODO: Should make it more error-safe
            } else {
                this._internalGetRemoteAuthorizationState();
            }
          }
        },

        _getApplicationInfo : function() {
            var self = this;
            //TODO: beware 304 status response
            this.get("/applications/" + this.options.client_id, function(response) {
                self.appInfo = response[2];
                self._internalGetRemoteAuthorizationState();
            }, {"no-cache":true});
        },

        _isMELI: function () {
          //are we inside MELI?
          return (document.domain.match(/(.*\.)?((mercadolibre\.com(\.(ar|ve|uy|ec|pe|co|pa|do|cr))?)|(mercadolibre\.cl)|(mercadolivre\.com\.br)|(mercadolivre\.pt))/) || document.domain.match(/.*localhost.*/))&& cookie('orgapi') != null;
        },

        _internalGetRemoteAuthorizationState : function() {
          //gets authorization state with client id loaded
          var self = this;
            //TODO: change when api is ready. Uses cookies instead of real api call
            //TODO: what happens ig no orgapi present????
          if (this._isMELI()) {
            self._onAuthorizationStateLoaded(
              {
                status: 'AUTHORIZED',
                authorization_credential: {
                  access_token: cookie('orgapi'),
                  expires_in: new Date(new Date().getTime() + parseInt(10800) * 1000).getTime(),
                  user_id: cookie("orguserid")
                }
              });
          } else {
              Sroc.get('https://www.mercadolibre.com/jms/' + this.appInfo.site_id.toLowerCase() + '/auth/authorization_state',
                {'client_id' : this.options.client_id}, function(){
                    var authorizationState = response[2];
                    self._onAuthorizationStateLoaded(authorizationState);
                });
            }
        },

        _onAuthorizationStateLoaded : function(authorizationState) {
        //TODO: This code should be moved to xd.htm
          //save new auth state in iFrame
          XAuth.extend({
            key : this.options.client_id + this.AUTHORIZATION_STATE,
            data : JSON.stringify(authorizationState),
            expire : new Date().getTime() + 10800 * 1000 /* expira en 3 hs */,
            extend : [ "*" ]
          });
          this.authorizationState[this.options.client_id + this.AUTHORIZATION_STATE]= authorizationState;
          this.isAuthorizationStateAvaible = false;
          this._onAuthorizationStateAvailable(authorizationState);
        },

        _getIdState: function() {
           return ({
             status: 'AUTHORIZED',
             authorization_credential: {
               access_token: cookie('orgid'),
               expires_in: 0,
               onlyID: true
             }
           });
        },

        _onAuthorizationStateAvailable : function(authorizationState) {
          //all callbacks waiting for authorizationState
          this.isAuthorizationStateAvaible = true;
          var size = this.authorizationStateAvailableCallbacks.length;
          for ( var i = 0; i < size; i++) {
              this.authorizationStateAvailableCallbacks[i](authorizationState);
          }
        },

        _getAuthorizationState : function(callback, onlyID) {
          // credentials valid or MELI + orgid
          if (this.isAuthorizationStateAvaible || (this._isMELI() && onlyID && cookie("orgid"))) {
              var key = this.options.client_id + this.AUTHORIZATION_STATE;
              //TODO: Check expiration
              if (this.authorizationState[key] != null && !this._isExpired(this.authorizationState[key])) {
                  callback(this.authorizationState[key]);
              } else if (this._isMELI() && onlyID && cookie("orgid")) {
                this.authorizationState[key] = this._getIdState();
                callback( this._getIdState());
              } else {
                //expired credentials, resynchronuze pushing this action
                this.isAuthorizationStateAvaible = false;
                this.authorizationStateAvailableCallbacks.push(callback);
                this._synchronizeAuthorizationState();
              }
          }else{
              this.authorizationStateAvailableCallbacks.push(callback);
              this._synchronizeAuthorizationState();
          }
        },

        _partial: function (func /* , 0..n args */ ) {
          var args = Array.prototype.slice.call(arguments, 1);
          return function () {
            var allArguments = args.concat(Array.prototype.slice.call(arguments));
            return func.apply(this, allArguments);
          };
        },
        _wrap: function (callback) {
          var key = this.options.client_id + this.AUTHORIZATION_STATE;
          var self=this;
          var wrapper = function(response) {
            //check if token is invalid
           
            var properCallback = self._partial(callback, response);
            if (response[0] != 200 && response[2].error != null && response[2].error.match(/.*(token|OAuth).*/)) {
              self.isAuthorizationStateAvaible = false;
              //delete token
              XAuth.expire({key:key, callback: properCallback});
        
            } else {
              properCallback();
            }
          };
          return wrapper;
        },
        get : function(url, callback, params) {
          //no cache params
          Sroc.get(this._url(url, params), {}, this._wrap(callback));
        },

        post : function(url, params, callback) {
          Sroc.post(this._url(url), params, this._wrap(callback));
        },

        remove : function(url, params, callback) {
          if (!params) {
            params = {};
          }
          params._method = "DELETE";
          Sroc.get(this._url(url, params), params, this._wrap(callback));
        },

        getToken : function() {
	  var key = this.options.client_id + this.AUTHORIZATION_STATE;
	  var authorizationState = this.authorizationState[key];
	  if (authorizationState != null) {
	    var token = authorizationState.authorization_credential.access_token;
	    var expirationTime = authorizationState.authorization_credential.expires_in;
	    if (token && expirationTime) {
		var dateToExpire = new Date(parseInt(expirationTime));
		var now = new Date();
		if (dateToExpire <= now) {
		    token = null;
		}
	    }
	    return (token && token.length > 0) ? token : null;
	  } else {
            return null;
          }
        },

        withLogin : function(successCallback, failureCallback, forceLogin, onlyID) {
            var self = this;
            this._getAuthorizationState(function(authorizationState){
                if(authorizationState.status == 'AUTHORIZED'){
                    successCallback();
                }else if(forceLogin){
                    self.pendingCallback = successCallback;
                    self.login();
                }else{
                    if (failureCallback) {
                      failureCallback();
                    }
                }
            }, onlyID);
        },

        login : function() {
            this._popup(this._authorizationURL(true));
        },

        bind : function(event, callback) {
            if (typeof (this.callbacks[event]) == "undefined")
                this.callbacks[event] = [];
            this.callbacks[event].push(callback);
        },

        trigger : function(event, args) {
            var callbacks = this.callbacks[event];

            if (typeof (callbacks) == "undefined") {
                return;
            }
            for ( var i = 0; i < callbacks.length; i++) {
                callbacks[i].apply(null, args);
            }
        },

        logout : function() {
            this.store.setSecure("access_token", "");
            this._triggerSessionChange();
        },

        _triggerSessionChange : function() {
            this.trigger("session.change", [ this.getToken() ? true : false ]);
        },

        _url : function(url, params) {
            url = this.baseURL + url;
            var urlParams = "";
            if (params) {
              for(var key in params){
                if (urlParams.length > 0) {
                  urlParams += "&";
                }
                if (key == "no-cache" && params[key])
                  params[key] = Math.random()*Math.random();
                urlParams += key + "=" + params[key];
              }
            }

            var token = this.getToken();

            if (token) {
                var append = url.indexOf("?") > -1 ? "&" : "?";

                url += append + "access_token=" + token;
            }
            if (urlParams.length > 0) {
                append = url.indexOf("?") > -1 ? "&" : "?";
                url += append + urlParams;
            }

            return url;
        },

        _parseHash : function() {
            var hash = window.location.hash.substr(1);

            if (hash.length == 0) {
                return;
            }

            var self = this;

            var pairs = hash.split("&");

            for ( var i = 0; i < pairs.length; i++) {
                var pair = null;

                if (pair = pairs[i].match(/([A-Za-z_\-]+)=(.*)$/)) {
                    self.hash[pair[1]] = pair[2];
                }
            }
        },

        // Check if we're returning from a redirect
        // after authentication inside an iframe.
        _checkPostAuthorization : function() {
            if (this.hash.state && this.hash.state == "iframe" && !this.hash.error) {
                var p = window.opener || window.parent;

                p.MercadoLibre._loginComplete(this.hash);
            }
        },

        _loginComplete : function(hash) {
            if (this._popupWindow) {
                this._popupWindow.close();
            }
            
            if(!hash.access_token){
                //If the user denies authorization exit 
                return
            }
            
           //build authorizationState object
           var authorizationState = {
               status: 'AUTHORIZED',
               authorization_credential: {
                   accessToken: hash.access_token,
                   expiresIn: new Date(new Date().getTime() + parseInt(hash.expires_in) * 1000).getTime(),
                   userID: hash.user_id
               },
               hash: hash.hash 
           };
           //update our authorization credentials
           this._onAuthorizationStateLoaded(authorizationState);
          
           this._triggerSessionChange();
    
           if (this.pendingCallback)
                this.pendingCallback();
        },

        _popup : function(url) {
            if (!this._popupWindow || this._popupWindow.closed) {
                var width = 830;
                var height = 510;
                var left = parseInt((screen.availWidth - width) / 2);
                var top = parseInt((screen.availHeight - height) / 2);

                this._popupWindow = (window.open(url, "", "toolbar=no,status=no,location=yes,menubar=no,resizable=no,scrollbars=no,width=" + width + ",height=" + height + ",left=" + left + ",top=" + top + "screenX=" + left + ",screenY=" + top));
            } else {
                this._popupWindow.focus();
            }
        },

        _authorizationURL : function(interactive) {
            var xd_url = window.location.protocol + "//" + window.location.host + this.options.xd_url;

            return this.authorizationURL + "?redirect_uri=" + escape(xd_url) + "&response_type=token" + "&client_id=" + this.options.client_id + "&state=iframe" + "&display=popup" + "&interactive=" + (interactive ? 1 : 0);
        }
    };

    MercadoLibre._parseHash();

    MercadoLibre._checkPostAuthorization();

    window.MercadoLibre = MercadoLibre;

})(cookie, XAuth);
