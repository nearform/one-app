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

// Headers are under a key with a dangling underscore
/* eslint-disable no-underscore-dangle */
import fetch from 'isomorphic-fetch';
import yargs, { argv } from 'yargs';

import { setUpTestRunner, tearDownTestRunner } from './helpers/testRunner';
import { waitFor } from './helpers/wait';
import {
  deployBrokenModule,
  dropModuleVersion,
} from './helpers/moduleDeployments';
import {
  removeModuleFromModuleMap,
  addModuleToModuleMap,
  writeModuleMap,
  readModuleMap,
  retrieveModuleIntegrityDigests,
} from './helpers/moduleMap';
import {
  searchForNextLogMatch,
} from './helpers/logging';
import createFetchOptions from './helpers/fetchOptions';
import getRandomPortNumber from './helpers/getRandomPortNumber';
import transit from '../../src/universal/utils/transit';

yargs.array('remoteOneAppEnvironment');

jest.setTimeout(95000);

describe('Tests that require Docker setup', () => {
  describe('one-app successfully started', () => {
    const defaultFetchOptions = createFetchOptions();
    let originalModuleMap;
    const oneAppLocalPortToUse = getRandomPortNumber();
    const appAtTestUrls = {
      fetchUrl: `https://localhost:${oneAppLocalPortToUse}`,
      browserUrl: 'https://one-app:8443',
    };

    let browser;

    beforeAll(async () => {
      removeModuleFromModuleMap('late-frank');
      originalModuleMap = readModuleMap();
      ({ browser } = await setUpTestRunner({ oneAppLocalPortToUse }));
    });

    afterAll(async () => {
      await tearDownTestRunner({ browser });
      writeModuleMap(originalModuleMap);
    });

    test('app rejects CORS POST requests', async () => {
      const response = await fetch(
        `${appAtTestUrls.fetchUrl}/success`,
        {
          ...defaultFetchOptions,
          method: 'POST',
          headers: {
            origin: 'test.example.com',
          },
        }
      );
      expect(response.status).toBe(200);
      expect(response.headers._headers).not.toHaveProperty('access-control-allow-origin');
      expect(response.headers._headers).not.toHaveProperty('access-control-expose-headers');
      expect(response.headers._headers).not.toHaveProperty('access-control-allow-credentials');
    });

    test('app rejects CORS OPTIONS pre-flight requests for POST', async () => {
      const response = await fetch(
        `${appAtTestUrls.fetchUrl}/success`,
        {
          ...defaultFetchOptions,
          method: 'OPTIONS',
          headers: {
            origin: 'test.example.com',
          },
        });

      expect(response.status).toBe(200);
      // preflight-only headers
      expect(response.headers._headers).not.toHaveProperty('access-control-max-age');
      expect(response.headers._headers).not.toHaveProperty('access-control-allow-methods');
      expect(response.headers._headers).not.toHaveProperty('access-control-allow-headers');
      // any respnse headers
      expect(response.headers._headers).not.toHaveProperty('access-control-allow-origin');
      expect(response.headers._headers).not.toHaveProperty('access-control-expose-headers');
      expect(response.headers._headers).not.toHaveProperty('access-control-allow-credentials');
    });

    describe('tenant without corsOrigins set', () => {
      beforeAll(async () => {
        await addModuleToModuleMap({
          moduleName: 'frank-lloyd-root',
          version: '0.0.2',
          integrityDigests: retrieveModuleIntegrityDigests({ moduleName: 'frank-lloyd-root', version: '0.0.2' }),
        });
        // wait for change to be picked up
        await waitFor(5000);
      });

      // Success is tested in block:
      // "Tests that can run against either local Docker setup or remote One App environments"
      test('app rejects CORS POST requests for partials', async () => {
        const response = await fetch(
          `${appAtTestUrls.fetchUrl}/html-partial/en-US/frank-the-parrot`,
          {
            ...defaultFetchOptions,
            method: 'POST',
            headers: {
              origin: 'test.example.com',
            },
            body: {
              message: 'Hello!',
            },
          }
        );
        expect(response.status).toBe(200);
        expect(response.headers._headers).not.toHaveProperty('access-control-allow-origin');
        expect(response.headers._headers).not.toHaveProperty('access-control-expose-headers');
        expect(response.headers._headers).not.toHaveProperty('access-control-allow-credentials');
      });

      afterAll(async () => {
        writeModuleMap(originalModuleMap);
        // wait for modules to revert
        await waitFor(5000);
      });
    });

    describe('one-app server provides reporting routes', () => {
      describe('client reported errors', () => {
        let reportedErrorSearch;
        const errorMessage = 'reported client error';
        const clientReportedErrorLog = new RegExp(errorMessage);

        beforeAll(() => {
          reportedErrorSearch = searchForNextLogMatch(clientReportedErrorLog);
        });

        test('logs errors when reported to /_/report/errors', async () => {
          const resp = await fetch(
            `${appAtTestUrls.fetchUrl}/_/report/errors`,
            {
              ...defaultFetchOptions,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify([{ msg: errorMessage }]),
            }
          );

          expect(resp.status).toEqual(204);

          await expect(reportedErrorSearch).resolves.toMatchSnapshot();
        });
      });

      describe('csp-violations reported to server', () => {
        let reportedCspViolationSearch;
        // const violation = 'csp violation';
        const cspViolationLog = /CSP Violation: {.*document-uri.*bad.example.com/;

        beforeAll(() => {
          reportedCspViolationSearch = searchForNextLogMatch(cspViolationLog);
        });

        test('logs violations reported to /_/report/errors', async () => {
          const resp = await fetch(
            `${appAtTestUrls.fetchUrl}/_/report/security/csp-violation`,
            {
              ...defaultFetchOptions,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                'csp-report': {
                  'document-uri': 'bad.example.com',
                },
              }),
            }
          );

          expect(resp.status).toEqual(204);
          await expect(reportedCspViolationSearch).resolves.toMatchSnapshot();
        });
      });
    });

    describe('holocron', () => {
      let sampleModuleVersion;

      beforeAll(async () => {
        sampleModuleVersion = '0.0.0';
      });

      test('loads modules on start', async () => {
        await browser.url(`${appAtTestUrls.browserUrl}/healthy-frank`);
        const headerBody = await browser.$('.helloFrank');
        const headerText = await headerBody.getText();
        expect(headerText.includes('Im Frank, and healthy')).toBe(true);
      });

      describe('module removed from module map', () => {
        afterAll(() => {
          const integrityDigests = retrieveModuleIntegrityDigests({ moduleName: 'healthy-frank', version: sampleModuleVersion });
          addModuleToModuleMap({
            moduleName: 'healthy-frank',
            version: sampleModuleVersion,
            integrityDigests,
          });
        });

        test('removes module from one-app', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/demo/healthy-frank`);
          const headerBody = await browser.$('.helloFrank');
          const headerText = await headerBody.getText();
          expect(headerText.includes('Im Frank, and healthy')).toBe(true);

          removeModuleFromModuleMap('healthy-frank');
          // not ideal but need to wait for app to poll;
          await waitFor(5000);

          await browser.url(`${appAtTestUrls.browserUrl}/demo/healthy-frank`);
          const missingModuleMessageElement = await browser.$('.missingModuleMessage');
          const missingModuleNameElement = await missingModuleMessageElement.$('.missingModuleName');
          const missingModuleName = await missingModuleNameElement.getText();
          expect(missingModuleName.includes('healthy-frank')).toBe(true);
        });
      });

      describe('new module added to module map', () => {
        afterAll(() => removeModuleFromModuleMap('late-frank'));

        test('loads new module when module map updated', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/demo/late-frank`);
          const missingModuleMessageElement = await browser.$('.missingModuleMessage');
          const missingModuleNameElement = await missingModuleMessageElement.$('.missingModuleName');
          const missingModuleName = await missingModuleNameElement.getText();
          expect(missingModuleName.includes('late-frank')).toBe(true);

          await addModuleToModuleMap({
            moduleName: 'late-frank',
            version: sampleModuleVersion,
            integrityDigests: retrieveModuleIntegrityDigests({ moduleName: 'late-frank', version: sampleModuleVersion }),
          });
          // not ideal but need to wait for app to poll;
          await waitFor(5000);

          await browser.url(`${appAtTestUrls.browserUrl}/demo/late-frank`);
          const frankHeader = await browser.$('.lateFrank');
          const frankText = await frankHeader.getText();
          expect(frankText.includes('Sorry Im late!')).toBe(true);
        });
      });

      describe('tenant module config', () => {
        test('provideStateConfig sets config', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/success`);
          const configPreTag = await browser.$('.value-provided-from-config');
          const configText = await configPreTag.getText();
          expect(configText).toEqual('https://internet-origin-dev.example.com/some-api/v1');
        });

        describe('root module provides invalid config', () => {
          let failedRootModuleConfigSearch;
          const failedRootModuleConfig = /Root module attempted to set the following non-overrideable options for the client but not the server:\\n\s{2}someApiUrl/;

          beforeEach(async () => {
            const nextVersion = '0.0.1';
            failedRootModuleConfigSearch = searchForNextLogMatch(failedRootModuleConfig);
            await addModuleToModuleMap({
              moduleName: 'frank-lloyd-root',
              version: nextVersion,
              integrityDigests: retrieveModuleIntegrityDigests({ moduleName: 'frank-lloyd-root', version: nextVersion }),
            });
            await waitFor(5000);
          });

          afterEach(async () => {
            writeModuleMap(originalModuleMap);
          });

          test('writes an error to log when failed module config', async () => {
            await expect(failedRootModuleConfigSearch).resolves.toMatch(failedRootModuleConfig);
          });

          test('with an unhealthy config results in keeping healthy module', async () => {
            await browser.url(`${appAtTestUrls.browserUrl}/success`);
            const configPreTag = await browser.$('.value-provided-from-config');
            const configText = await configPreTag.getText();
            expect(configText).toEqual('https://internet-origin-dev.example.com/some-api/v1');
          });
        });
      });

      describe('child module config', () => {
        test('validateStateConfig validates an acceptable tenant module config', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/demo/picky-frank`);
          const versionSelector = await browser.$('.version');
          const version = await versionSelector.getText();
          expect(version).toEqual('v0.0.0');
        });

        describe('child module fails to validate tenant module config', () => {
          let failedChildModuleSearch;
          const failedChildModuleValidation = /Error: Failed to pass correct url on client/;

          beforeEach(async () => {
            const nextVersion = '0.0.1';
            failedChildModuleSearch = searchForNextLogMatch(failedChildModuleValidation);
            await addModuleToModuleMap({
              moduleName: 'picky-frank',
              version: nextVersion,
              integrityDigests: retrieveModuleIntegrityDigests({ moduleName: 'picky-frank', version: nextVersion }),
            });
            await waitFor(5000);
          });

          afterEach(async () => {
            writeModuleMap(originalModuleMap);
          });

          test('writes an error to log when failed child module validation', async () => {
            await expect(failedChildModuleSearch).resolves.toMatch(failedChildModuleValidation);
          });

          test('with a validation failure one app serves healthy module', async () => {
            await browser.url(`${appAtTestUrls.browserUrl}/demo/picky-frank`);
            const versionSelector = await browser.$('.version');
            const version = await versionSelector.getText();
            expect(version).toEqual('v0.0.0');
          });
        });
      });

      describe('loading broken module', () => {
        let brokenModuleDetails;
        const blocklistRegex = /bad-frank\.node\.js added to blocklist: bad things will happen/;
        let blocklistingOfModuleLogSearch;

        beforeAll(async () => {
          brokenModuleDetails = {
            moduleName: 'bad-frank',
            version: sampleModuleVersion,
            integrityDigests: {
              browser: 'sha256-4XVXHQGFftIRsBvUKIobtVQjouQBaq11PwPHDMzQ2Hk= sha384-FX5cUzgC22jk+RGJ47h07QVt4q/cvv+Ck57CY0A8bwEQDn+w48zYlwMDlh9OxRzq',
              node: 'sha256-4XVXHQGFftIRsBvUKIobtVQjouQBaq11PwPHDMzQ2Hk= sha384-FX5cUzgC22jk+RGJ47h07QVt4q/cvv+Ck57CY0A8bwEQDn+w48zYlwMDlh9OxRzq',
              legacyBrowser: 'sha256-4XVXHQGFftIRsBvUKIobtVQjouQBaq11PwPHDMzQ2Hk= sha384-FX5cUzgC22jk+RGJ47h07QVt4q/cvv+Ck57CY0A8bwEQDn+w48zYlwMDlh9OxRzq',
            },
          };
          blocklistingOfModuleLogSearch = searchForNextLogMatch(blocklistRegex);
          await deployBrokenModule(brokenModuleDetails);
          await addModuleToModuleMap(brokenModuleDetails);
          // not ideal but need to wait for app to poll;
          await waitFor(5000);
        });

        afterAll(async () => {
          writeModuleMap(originalModuleMap);
          await dropModuleVersion(brokenModuleDetails);
        });

        test('bad-frank added to blocklist', async () => {
          await expect(blocklistingOfModuleLogSearch).resolves.toMatch(blocklistRegex);
        });

        test('does not load broken module', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/demo/bad-frank`);
          const missingModuleMessageElement = await browser.$('.missingModuleMessage');
          const missingModuleNameElement = await missingModuleMessageElement.$('.missingModuleName');
          const missingModuleName = await missingModuleNameElement.getText();
          expect(missingModuleName.includes('bad-frank')).toBe(true);
        });

        test('one-app remains healthy', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/success`);
          const header = await browser.$('.helloMessage');
          const headerText = await header.getText();
          expect(headerText).toBe('Hello! One App is successfully rendering its Modules!');
        });
      });

      describe('loading module with an integrity mismatch on the server', () => {
        const blocklistRegex = /SRI for module at https:\/\/sample-cdn\.frank\/modules\/.+\/sneaky-frank\/0\.0\.0\/sneaky-frank\.node\.js must match SRI in module map/;
        let blocklistingOfModuleLogSearch;
        let moduleDetails;
        beforeAll(async () => {
          const version = '0.0.0';
          moduleDetails = {
            moduleName: 'sneaky-frank',
            version,
            integrityDigests: {
              browser: 'sha256-GmvP4f2Fg21H5bLWdUNqFFuLeGnLbXD7FDrb0CJL6CA= sha384-sewv7JNAfdDA+jcS+nn4auGm5Sad4GaMSxvT3IIlAdsLhUnxCjqWrWHbt4PWBJoo',
              legacyBrowser: 'sha256-GmvP4f2Fg21H5bLWdUNqFFuLeGnLbXD7FDrb0CJL6CA= sha384-sewv7JNAfdDA+jcS+nn4auGm5Sad4GaMSxvT3IIlAdsLhUnxCjqWrWHbt4PWBJoo',
              node: 'invalid-digest',
            },
          };
          await deployBrokenModule({
            moduleName: moduleDetails.moduleName,
            version: moduleDetails.version,
          });
          await addModuleToModuleMap(moduleDetails);
          blocklistingOfModuleLogSearch = searchForNextLogMatch(blocklistRegex);
          // not ideal but need to wait for app to poll;
          await waitFor(5000);
        });

        afterAll(async () => {
          writeModuleMap(originalModuleMap);
          await dropModuleVersion({
            moduleName: moduleDetails.moduleName,
            version: moduleDetails.version,
          });
        });

        test('sneaky-frank added to blocklist', async () => {
          await expect(blocklistingOfModuleLogSearch).resolves.toMatch(blocklistRegex);
        });

        test('does not load broken module', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/demo/sneaky-frank`);
          const missingModuleMessageElement = await browser.$('.missingModuleMessage');
          const missingModuleNameElement = await missingModuleMessageElement.$('.missingModuleName');
          const missingModuleName = await missingModuleNameElement.getText();
          expect(missingModuleName.includes('sneaky-frank')).toBe(true);
        });

        test('one-app remains healthy', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/success`);
          const header = await browser.$('.helloMessage');
          const headerText = await header.getText();
          expect(headerText).toBe('Hello! One App is successfully rendering its Modules!');
        });
      });

      describe('loading module with an integrity mismatch on the client', () => {
        let moduleDetails;

        beforeAll(async () => {
          const version = '0.0.0';
          const moduleName = 'healthy-frank';
          moduleDetails = {
            moduleName,
            version,
            integrityDigests: {
              ...retrieveModuleIntegrityDigests({ moduleName, version }),
              browser: 'sha256-invalid-digest sha384-invalid-digest',
              legacyBrowser: 'sha256-invalid-digest sha384-invalid-digest',
            },
          };
          await addModuleToModuleMap(moduleDetails);
          // not ideal but need to wait for app to poll;
          await waitFor(5000);
        });

        afterAll(() => {
          writeModuleMap(originalModuleMap);
        });

        test('does not load unverified module on the browser', async () => {
          await browser.url(`${appAtTestUrls.browserUrl}/demo/healthy-frank`);
          const consoleLogs = await browser.getLogs('browser');

          expect(consoleLogs).toEqual(
            expect.arrayContaining([{
              level: 'SEVERE',
              message: expect.stringMatching(/https:\/\/one-app:8443\/demo\/healthy-frank - Failed to find a valid digest in the 'integrity' attribute for resource 'https:\/\/sample-cdn\.frank\/modules\/.+\/healthy-frank\/0\.0\.0\/healthy-frank.browser.js\?key=not-used-in-development' with computed SHA-256 integrity '.+'\. The resource has been blocked\./),
              source: 'security',
              timestamp: expect.any(Number),
            }])
          );
        });
      });

      describe('needy frank can make universal requests to an api', () => {
        afterAll(async () => {
          writeModuleMap(originalModuleMap);
        });
        describe('with iguazu', () => {
          describe('with ssr enabled', () => {
            beforeAll(async () => {
              const integrityDigests = retrieveModuleIntegrityDigests({ moduleName: 'needy-frank', version: '0.0.0' });
              await addModuleToModuleMap({
                moduleName: 'needy-frank',
                version: '0.0.0',
                integrityDigests,
              });
              await waitFor(5000);
            });
            test('should have SSR preload module state with readPosts', async () => {
              await browser.url(`${appAtTestUrls.browserUrl}/demo/needy-frank?api=https://fast.api.frank/posts`);
              const needyFrankModuleStateTag = await browser.$('.needy-frank-loaded-data');
              const needyFrankModuleState = await needyFrankModuleStateTag.getText();
              expect(JSON.parse(needyFrankModuleState)).toMatchSnapshot();
            });

            describe('uses tenant provided fetch', () => {
              test('should timeout on server if request exceeds one second', async () => {
                await browser.url(`${appAtTestUrls.browserUrl}/demo/needy-frank?api=https://slow.api.frank/posts`);
                const needyFrankModuleStateTag = await browser.$('.needy-frank-loaded-data');
                const needyFrankModuleState = await needyFrankModuleStateTag.getText();
                expect(JSON.parse(needyFrankModuleState)).toEqual({
                  procedures: {
                    pendingCalls: {
                      readPosts: {},
                    },
                    procedureCaches: {
                      readPosts: {
                        '8cd6dad8022e63aee356ac38f2f079d979eb40ef': {
                          message: 'Request to https://***/posts was too slow',
                          name: 'Error',
                        },
                      },
                    },
                  },
                  resources: {},
                });
              });
            });
          });
          describe('with ssr disabled', () => {
            beforeAll(async () => {
              const integrityDigests = retrieveModuleIntegrityDigests({ moduleName: 'needy-frank', version: '0.0.1' });
              await addModuleToModuleMap({
                moduleName: 'needy-frank',
                version: '0.0.1',
                integrityDigests,
              });
              await waitFor(5000);
            });
            test('should timeout on client if request exceeds six seconds', async () => {
              await browser.url(`${appAtTestUrls.browserUrl}/demo/needy-frank?api=https://extra-slow.api.frank/posts`);
              await waitFor(7000);
              const needyFrankModuleStateTag = await browser.$('.needy-frank-loaded-data');
              const needyFrankModuleState = await needyFrankModuleStateTag.getText();
              expect(JSON.parse(needyFrankModuleState)).toMatchSnapshot({
                procedures: {
                  procedureCaches: {
                    readPosts: {
                      de48373b416b8d2af053d04402c35d194568ffdd: {
                        stack: expect.stringContaining('Error: https://extra-slow.api.frank/posts after 6000ms'),
                      },
                    },
                  },
                },
              });
            });
          });
        });
      });
    });

    describe('module requires SafeRequest Restricted Attributes not provided by tenant module', () => {
      const requestRestrictedAttributesRegex = /Error: Tenant root must extendSafeRequestRestrictedAttributes with cookies: \[macadamia,homebaked\]/;
      let requestRestrictedAttributesLogSearch;

      beforeAll(async () => {
        requestRestrictedAttributesLogSearch = searchForNextLogMatch(
          requestRestrictedAttributesRegex
        );
        await addModuleToModuleMap({
          moduleName: 'vitruvius-franklin',
          version: '0.0.1',
          integrityDigests: retrieveModuleIntegrityDigests({ moduleName: 'vitruvius-franklin', version: '0.0.1' }),
        });
        // not ideal but need to wait for app to poll;
        await waitFor(5000);
      });

      afterAll(() => {
        writeModuleMap(originalModuleMap);
      });

      it('does not update the module in memory', async () => {
        await browser.url(`${appAtTestUrls.browserUrl}/vitruvius`);
        const versionSelector = await browser.$('.version');
        const version = await versionSelector.getText();
        expect(version).toEqual('0.0.0');
      });

      it('does not load module', async () => {
        await expect(requestRestrictedAttributesLogSearch)
          .resolves
          .toMatch(requestRestrictedAttributesRegex);
      });
    });

    test('app calls loadModuleData to run async requests using Tenant provided fetchClient', async () => {
      const response = await fetch(`${appAtTestUrls.fetchUrl}/demo/ssr-frank`, {
        ...defaultFetchOptions,
      });
      const htmlData = await response.text();
      const scriptContents = htmlData.match(/<script id="initial-state" nonce=\S+>([^<]+)<\/script>/)[1];
      const initialState = scriptContents.match(/window\.__INITIAL_STATE__ = "([^<]+)";/)[1];
      const state = transit.fromJSON(initialState.replace(/\\/g, ''));
      expect(state.getIn(['modules', 'ssr-frank', 'data'])).toEqual({
        posts: [
          {
            author: 'typicode',
            id: 1,
            title: 'json-server',
          },
        ],
        secretMessage: 'you are being watched',
      });
    });

    describe('module root configureRequestLog', () => {
      it('has included userId from cookies in request log', async () => {
        const requestLogRegex = /some-user-id-1234/;
        const searchForRequerstLog = searchForNextLogMatch(requestLogRegex);
        await browser.setCookies({
          name: 'userId',
          value: 'some-user-id-1234',
        });
        await browser.url(`${appAtTestUrls.browserUrl}/success`);
        await expect(searchForRequerstLog).resolves.toMatch(requestLogRegex);
      });

      it('log gets updated when Tenancy Root module gets updated', async () => {
        await addModuleToModuleMap({
          moduleName: 'frank-lloyd-root',
          version: '0.0.2',
          integrityDigests: retrieveModuleIntegrityDigests({ moduleName: 'frank-lloyd-root', version: '0.0.2' }),
        });
        const waiting = waitFor(5000);

        const requestLogRegex = /abcdefg123456/;
        const searchForRequerstLog = searchForNextLogMatch(requestLogRegex);
        await browser.setCookies({
          name: 'guuid',
          value: 'abcdefg123456',
        });
        await waiting;
        await browser.url(`${appAtTestUrls.browserUrl}/success`);
        await expect(searchForRequerstLog).resolves.toMatch(requestLogRegex);
      });

      afterAll(() => {
        writeModuleMap(originalModuleMap);
      });
    });
  });
});

describe('Tests that can run against either local Docker setup or remote One App environments', () => {
  const { remoteOneAppEnvironment } = argv;
  const oneAppLocalPortToUse = getRandomPortNumber();
  const defaultFetchOpts = createFetchOptions({ targetRemoteAppInstance: remoteOneAppEnvironment });
  // urls are different bt what fetch uses and what selenium uses bc fetch runs from host and
  // selenium runs inside a docker container
  const appAtTestInstances = remoteOneAppEnvironment
    // conflicting eslint rules make it so that on running `lint --fix` this rule always fails
    // eslint-disable-next-line max-len
    ? remoteOneAppEnvironment.map((environmentUrl) => ({ fetchUrl: environmentUrl, browserUrl: environmentUrl }))
    : [{ fetchUrl: `https://localhost:${oneAppLocalPortToUse}`, browserUrl: 'https://one-app:8443' }];

  let browser;

  beforeAll(async () => {
    if (remoteOneAppEnvironment) {
      ({ browser } = await setUpTestRunner());
    } else {
      ({ browser } = await setUpTestRunner({ oneAppLocalPortToUse }));
    }
  });

  afterAll(() => tearDownTestRunner({ browser }));

  appAtTestInstances.forEach((appInstanceUrls) => {
    describe(`with ${appInstanceUrls.fetchUrl} - `, () => {
      test('app renders successfully on the browser with no console errors', async () => {
        await browser.url(`${appInstanceUrls.browserUrl}/success`);
        const header = await browser.$('.helloMessage');
        const headerText = await header.getText();
        const consoleLogs = await browser.getLogs('browser');

        expect(headerText).toBe('Hello! One App is successfully rendering its Modules!');
        expect(consoleLogs).toEqual([]);
      });

      test('app allows CORS POST requests for partials', async () => {
        const response = await fetch(
          `${appInstanceUrls.fetchUrl}/html-partial/en-US/frank-the-parrot`,
          {
            ...defaultFetchOpts,
            method: 'POST',
            headers: {
              origin: 'test.example.com',
            },
            body: {
              message: 'Hello!',
            },
          }
        );
        expect(response.status).toBe(200);
        expect(response.headers._headers).toHaveProperty('access-control-allow-origin');
        expect(response.headers._headers['access-control-allow-origin']).toEqual(['test.example.com']);
      });

      test('app renders frank-lloyd-root on a POST', async () => {
        const response = await fetch(
          `${appInstanceUrls.fetchUrl}/success`,
          {
            ...defaultFetchOpts,
            method: 'POST',
          });
        const pageHtml = await response.text();
        expect(
          pageHtml.includes('Hello! One App is successfully rendering its Modules!')
        ).toBe(true);
      });


      test('app passes vitruvius data to modules', async () => {
        await browser.addCookie({
          name: 'macadamia',
          value: 'digestive',
        });

        await browser.url(`${appInstanceUrls.browserUrl}/vitruvius`);
        const rootElement = await browser.$('#root');
        const pageHtml = await rootElement.getHTML();
        const data = JSON.parse(pageHtml.match(/<pre>([^<]+)<\/pre>/)[1].replace(/&quot;/g, '"'));
        expect(data).toMatchObject({
          config: expect.any(Object),
          req: {
            baseUrl: '',
            cookies: {
              macadamia: 'digestive',
            },
            headers: {
              'accept-language': 'en-US,en;q=0.9',
              host: expect.any(String),
              'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.75 Safari/537.36',
            },
            method: 'GET',
            originalUrl: '/vitruvius',
            params: {
              0: '/vitruvius',
            },
            protocol: expect.stringMatching(/^https?$/),
            query: {},
            url: '/vitruvius',
          },
        });
      });

      test('app passes JSON POST data to modules via vitruvius', async () => {
        const response = await fetch(
          `${appInstanceUrls.fetchUrl}/vitruvius`,
          {
            ...defaultFetchOpts,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              legacy: 'application',
              sendingData: 'in POSTs',
            }),
          }
        );

        const pageHtml = await response.text();
        const data = JSON.parse(pageHtml.match(/<pre>([^<]+)<\/pre>/)[1].replace(/&quot;/g, '"'));
        expect(data).toHaveProperty('req.body');
        expect(data.req.body).toEqual({
          legacy: 'application',
          sendingData: 'in POSTs',
        });
      });

      describe('routing', () => {
        test('IndexRedirect redirects', async () => {
          await browser.url(`${appInstanceUrls.browserUrl}/healthy-frank`);
          const url = await browser.getUrl();
          expect(url).toMatch(/healthy-frank\/simple/);
        });

        test('loadModuleData is not called when navigating to module on client', async () => {
          // start by navigating to ssr-frank without prefetch
          await browser.url(`${appInstanceUrls.browserUrl}/healthy-frank`);
          const noPrefetchLink = await browser.$('.ssr-frank-link');
          await noPrefetchLink.click();
          const renderedModuleData = await browser.$('.ssr-frank-loaded-data');
          const moduleStateAsText = await renderedModuleData.getText();
          const moduleState = JSON.parse(moduleStateAsText);
          expect(moduleState).toEqual({
            isLoading: false,
            isComplete: false,
            error: null,
            data: null,
          });
        });

        test('moduleRoutePrefetch calls loadModuleData', async () => {
          await browser.url(`${appInstanceUrls.browserUrl}/healthy-frank`);
          const prefetchButton = await browser.$('.prefetch-ssr-frank');
          const ssrFrankLink = await browser.$('.ssr-frank-link');
          await prefetchButton.click();
          // need to wait for prefetching to finish;
          await waitFor(1e3);
          await ssrFrankLink.click();
          const loadedData = await browser.$('.ssr-frank-loaded-data');
          const moduleStateAsText = await loadedData.getText();
          const moduleState = JSON.parse(moduleStateAsText);
          // calling loadModuleData calls https://fast.api.frank/posts
          expect(moduleState).toEqual({
            isLoading: false,
            isComplete: true,
            error: null,
            data: {
              posts: [{ id: 1, title: 'json-server', author: 'typicode' }],
              secretMessage: null,
            },
          });
        });

        test('not found requests are caught', async () => {
          const response = await fetch(`${appInstanceUrls.fetchUrl}/this-route-does-not-exist`, defaultFetchOpts);
          const body = await response.text();
          expect(response.status).toBe(404);
          expect(body).toContain('<div id="root">Not found</div>');
        });
      });

      describe('internationalization', () => {
        test('uses language from the language pack to render on the initial page load', async () => {
          await browser.url(`${appInstanceUrls.browserUrl}/demo/cultured-frankie`);
          const greetingMessage = await browser.$('#greeting-message');
          await waitFor(200);
          expect(await greetingMessage.getText()).toBe(
            'Hello, my name is Frankie and I am in the United States!'
          );
        });

        test('successfully switches languages', async () => {
          await browser.url(`${appInstanceUrls.browserUrl}/demo/cultured-frankie`);
          const greetingMessage = await browser.$('#greeting-message');
          const localeSelector = await browser.$('#locale-selector');
          await localeSelector.selectByVisibleText('en-CA');
          await waitFor(200);
          expect(await greetingMessage.getText()).toBe(
            'Hello, my name is Frankie and I am in Canada!'
          );
          await waitFor(200);
          await localeSelector.selectByVisibleText('es-MX');
          await waitFor(200);
          expect(await greetingMessage.getText()).toBe(
            'Hola! Mi nombre es Frankie y estoy en Mexico!'
          );
        });
      });

      describe('HTML rendering', () => {
        describe('partial only', () => {
          test('responds with an incomplete HTML document', async () => {
            const response = await fetch(`${appInstanceUrls.fetchUrl}/html-partial/en-US/frank-the-parrot?message=Hello!`, defaultFetchOpts);
            const body = await response.text();
            expect(body).toBe(
              '<style class="ssr-css">.frank-lloyd-root__styles__stylish___2aiGw{color:orchid}</style><pre class="value-provided-from-config">https://intranet-origin-dev.example.com/some-api/v1</pre><span class="message">Hello!</span>'
            );
          });
        });
      });
      describe('static error page', () => {
        test('responds with default error page on rendering error', async () => {
          const response = await fetch(
            `${appInstanceUrls.fetchUrl}/%c0.%c0./%c0.%c0./%c0.%c0./%c0.%c0./winnt/win.ini`,
            defaultFetchOpts
          );
          const body = await response.text();
          expect(body).toMatch(new RegExp('<!DOCTYPE html>'));
          expect(body).toMatch(new RegExp('<title>One App</title>'));
          expect(body).toMatch(new RegExp('<meta name="application-name" content="one-app">'));
          expect(body).toMatch(new RegExp('<h2 style="display: flex; justify-content: center; padding: 40px 15px 0px;">Loading Error</h2>'));
        });
      });
    });
  });
});
