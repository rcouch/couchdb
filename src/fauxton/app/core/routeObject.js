// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

define([
  "core/base",
  "backbone"
],
function(FauxtonAPI, Backbone) {

  var RouteObject = function(options) {
    this._options = options;

    this._configure(options || {});
    this.initialize.apply(this, arguments);
    this.addEvents();
  };

  var broadcaster = {};
  _.extend(broadcaster, Backbone.Events);

  RouteObject.on = function (eventName, fn) {
    broadcaster.on(eventName, fn); 
  };
  
  /* How Route Object events work
   To listen to a specific route objects events:

   myRouteObject = FauxtonAPI.RouteObject.extend({
    events: {
      "beforeRender": "beforeRenderEvent"
    },

    beforeRenderEvent: function (view, selector) {
      console.log('Hey, beforeRenderEvent triggered',arguments);
    },
   });

    It is also possible to listen to events triggered from all Routeobjects. 
    This is great for more general things like adding loaders, hooks.

    FauxtonAPI.RouteObject.on('beforeRender', function (routeObject, view, selector) {
      console.log('hey, this will trigger when any routeobject renders a view');
    });

   Current Events to subscribe to:
    * beforeFullRender -- before a full render is being done
    * beforeEstablish -- before the routeobject calls establish
    * AfterEstablish -- after the routeobject has run establish
    * beforeRender -- before a view is rendered
    * afterRender -- a view is finished being rendered
    * renderComplete -- all rendering is complete
    
  */

  // Piggy-back on Backbone's self-propagating extend function
  RouteObject.extend = Backbone.Model.extend;

  var routeObjectOptions = ["views", "routes", "events", "roles", "crumbs", "layout", "apiUrl", "establish"];

  _.extend(RouteObject.prototype, Backbone.Events, {
    // Should these be default vals or empty funcs?
    views: {},
    routes: {},
    events: {},
    crumbs: [],
    layout: "with_sidebar",
    apiUrl: null,
    disableLoader: false,
    loaderClassname: 'loader',
    renderedState: false,
    establish: function() {},
    route: function() {},
    roles: [],
    _promises: [],
    initialize: function() {}
  }, {

    renderWith: function(route, masterLayout, args) {
      //set the configs for this object
      this.config = {
        masterLayout: masterLayout,
        route: route,
        args: args
      };

      //check if it's done the full initial render
      this.checkRenderedState();

      this.triggerBroadcast('beforeEstablish');

      var success = _.bind(this.establishRouteSuccess, this),
          error = _.bind(this.establishError, this),
          promise = this.establish();

      //call all the establish functions in each route

      this.callEstablish(promise, success, error);

      // Track that we've done a full initial render
      this.setRenderedState(true);
      this.triggerBroadcast('renderComplete');
    },

    callEstablish: function(establishPromise, successCallback, errorCallback){
      this.addPromise(establishPromise);
      FauxtonAPI.when(establishPromise).then(successCallback, errorCallback); 
    },
    establishViewSuccess: function(viewInfo, resp, xhr){
      console.log(viewInfo);
      var masterLayout = this.config.masterLayout;
      masterLayout.setView(viewInfo.selector, viewInfo.view);
      masterLayout.renderView(viewInfo.selector);
      this.triggerBroadcast('afterRender', viewInfo.view, viewInfo.selector);
    },
    establishRouteSuccess: function(resp){
      this.triggerBroadcast('afterEstablish');
      this.renderEachView();
    },
    establishError: function(resp){
      if (!resp || !resp.responseText) { return; }
      FauxtonAPI.addNotification({
            msg: 'An Error occurred' + JSON.parse(resp.responseText).reason,
            type: 'error',
            clear: true
      });
    },
    setRenderedState: function(bool){
      this.renderedState = bool;
    },
    checkRenderedState: function(){
      // Only want to redo the template if its a full render
      if (!this.renderedState) {
        this.config.masterLayout.setTemplate(this.layout);
        this.triggerBroadcast('beforeFullRender');
      }
    },
    callViewEstablish: function(promise, viewinfo){
      var success = _.bind(this.establishViewSuccess, this, viewinfo),
          error = _.bind(this.establishError, this),
          callEstablish = _.bind(this.callEstablish, this);

          callEstablish(promise, success, error);

    },
    renderEachView: function(){
        var routeObject = this,
            triggerBroadcast = _.bind(this.triggerBroadcast, this),
            callViewEstablish = _.bind(this.callViewEstablish, this);
            
        _.each(routeObject.getViews(), function(view, selector) {
          var viewInfo = {view: view, selector: selector};

          if(view.hasRendered) { 
            triggerBroadcast('viewHasRendered', view, selector);
            return;
          }

          triggerBroadcast('beforeRender', view, selector);
          
          var viewPromise = view.establish();
          callViewEstablish(viewPromise, viewInfo);
        });
    },
    triggerBroadcast: function (eventName) {
      var args = Array.prototype.slice.call(arguments);
      this.trigger.apply(this, args);

      args.splice(0,1, eventName, this);
      broadcaster.trigger.apply(broadcaster, args);
    },

    get: function(key) {
      return _.isFunction(this[key]) ? this[key]() : this[key];
    },

    addEvents: function(events) {
      events = events || this.get('events');
      _.each(events, function(method, event) {
        if (!_.isFunction(method) && !_.isFunction(this[method])) {
          throw new Error("Invalid method: "+method);
        }
        method = _.isFunction(method) ? method : this[method];

        this.on(event, method);
      }, this);
    },

    _configure: function(options) {
      _.each(_.intersection(_.keys(options), routeObjectOptions), function(key) {
        this[key] = options[key];
      }, this);
    },

    getView: function(selector) {
      return this.views[selector];
    },

    setView: function(selector, view) {
      this.views[selector] = view;
      return view;
    },

    getViews: function() {
      return this.views;
    },

    removeViews: function () {
      _.each(this.views, function (view, selector) {
        view.remove();
        delete this.views[selector];
      }, this);
    },

    addPromise: function (promise) {
      if (_.isEmpty(promise)) { return; }

      if (_.isArray(promise)) {
        return _.each(promise, function (p) {
          this._promises.push(p);
        }, this);
      }

     this._promises.push(promise);
    },

    cleanup: function () {
      this.removeViews();
      this.rejectPromises();
    },

    rejectPromises: function () {
      _.each(this._promises, function (promise) {
        if (promise.state() === "resolved") { return; }
        if (promise.abort) {
          return promise.abort("Route change");
        } 

        promise.reject();
      }, this);

      this._promises = [];
    },

    getRouteUrls: function () {
      return _.keys(this.get('routes'));
    },

    hasRoute: function (route) {
      if (this.get('routes')[route]) {
        return true;
      }
      return false;
    },

    routeCallback: function (route, args) {
      var routes = this.get('routes'),
      routeObj = routes[route],
      routeCallback;

      if (typeof routeObj === 'object') {
        routeCallback = this[routeObj.route];
      } else {
        routeCallback = this[routeObj];
      }

      routeCallback.apply(this, args);
    },

    getRouteRoles: function (routeUrl) {
      var route = this.get('routes')[routeUrl];

      if ((typeof route === 'object') && route.roles) {
        return route.roles; 
      }

      return this.roles;
    }

  });
  return RouteObject;
});
