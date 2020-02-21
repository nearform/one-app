/*
 * Copyright 2019 American Express Travel Related Services Company, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */
import CircuitBreaker from 'opossum';
import React from 'react';
import { Provider } from 'react-redux';
import url, { Url } from 'url';
import { RouterContext } from '@americanexpress/one-app-router';
import { composeModules } from 'holocron';
import match from '../../universal/utils/matchPromisified';

import { renderForString, renderForStaticMarkup } from '../utils/reactRendering';
const wait = require('util').promisify(setTimeout)
const immediate = require('util').promisify(setImmediate)

const f = async ({ dispatch, modules }) => {
  const a = process.hrtime()
  const res = await dispatch(composeModules(modules))
  await immediate()
  // console.log(process.hrtime(a))
  return true
}

const options = {
  timeout: 100, // If our function takes longer than 3 seconds, trigger a failure
  errorThresholdPercentage: 10, // When 1% of requests fail, trip the circuit
  resetTimeout: 60000 // After 10 seconds, try again.
};
const breaker = new CircuitBreaker(f, options);
breaker.fallback(() => false)
// breaker.on('timeout', () => {
//  console.log('timeout')
// })

export default function createRequestHtmlFragment({ createRoutes }) {
  return async (req, res, next) => {
    try {
      const { store } = req;
      const { dispatch } = store;
      const routes = createRoutes(store);

      const { redirectLocation, renderProps } = await match({ routes, location: req.url });
      if (redirectLocation) {
        // support redirecting outside our app (i.e. domain/origin)
        // store more than pathname and search as a Url object as redirectLocation.state
        if (redirectLocation.state instanceof Url) {
          res.redirect(302, url.format(redirectLocation.state));
        } else {
          res.redirect(302, redirectLocation.pathname + redirectLocation.search);
        }
        return null;
      }

      if (!renderProps) {
        res.sendStatus(404);
        throw new Error('unable to match routes');
      }

      const { httpStatus } = renderProps.routes.slice(-1)[0];
      if (httpStatus) {
        res.status(httpStatus);
      }

      const props = {
        location: renderProps.location,
        params: renderProps.params,
        router: renderProps.router,
        routes: renderProps.routes,
      };

      const routeModules = renderProps.routes
        .filter((route) => !!route.moduleName)
        .map((route) => ({
          name: route.moduleName,
          props: {
            ...props,
            route,
          },
        }));

      const fallback = await breaker.fire({ dispatch, modules: routeModules });
      
      if (!fallback) {
        // console.error('circuit open')
        res.send('fallback!')
        return
      }

      // await dispatch(composeModules(routeModules))

      const state = store.getState();
      const disableScripts = state.getIn(['rendering', 'disableScripts']);
      const renderPartialOnly = state.getIn(['rendering', 'renderPartialOnly']);
      const renderMethod = (disableScripts || renderPartialOnly)
        ? renderForStaticMarkup : renderForString;

      /* eslint-disable react/jsx-props-no-spreading */
      const { renderedString, helmetInfo } = renderMethod(
        <Provider store={store}>
          <RouterContext {...renderProps} />
        </Provider>
      );
      /* eslint-ensable react/jsx-props-no-spreading */
      req.appHtml = renderedString;
      req.helmetInfo = helmetInfo;
    } catch (err) {
      console.error(`error creating request HTML fragment for ${req.url}`, err);
    }

    return next();
  };
}

function doSSR() {



}
