"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[2946],{"./src/component-library/Demos/03_1_Create_Rules.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{CreateRule:()=>CreateRule,__namedExportsOrder:()=>__namedExportsOrder,default:()=>__WEBPACK_DEFAULT_EXPORT__});var test_fixtures_table_fixtures__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./test/fixtures/table-fixtures.ts");const __WEBPACK_DEFAULT_EXPORT__={title:"Demos/03_CreateRule",component:__webpack_require__("./src/component-library/Pages/Rule/CreateRule.stories.tsx").CreateRule};var CreateRule={args:{onSubmit:function onSubmit(query){return Promise.resolve({status:"success",rules:[{RuleID:"123123143243",DID:"scope:dataset1"},{RuleID:"127849dsgs",DID:"scope:dataset2"}]})},didListComDOM:(0,test_fixtures_table_fixtures__WEBPACK_IMPORTED_MODULE_0__.Fs)(Array.from({length:100},(function(){return(0,test_fixtures_table_fixtures__WEBPACK_IMPORTED_MODULE_0__.wM)()}))),didValidation:function didValidation(query){var localErrorDIDs={ErrorList:[]};return query.DIDList.map((function(DID,index){DID.includes("error")&&localErrorDIDs.ErrorList.push({DID,ErrorCodes:[421],Message:"This DID is invalid"})})),0===localErrorDIDs.ErrorList.length?Promise.resolve(localErrorDIDs):Promise.reject(localErrorDIDs)},rseListComDOM:(0,test_fixtures_table_fixtures__WEBPACK_IMPORTED_MODULE_0__.Fs)(Array.from({length:100},(function(){return(0,test_fixtures_table_fixtures__WEBPACK_IMPORTED_MODULE_0__.Pi)()})))}};CreateRule.parameters={...CreateRule.parameters,docs:{...CreateRule.parameters?.docs,source:{originalSource:'{\n  args: {\n    onSubmit: (query: TCreateRuleFeatureRequestParams): Promise<CreateRulesViewModel> => {\n      return Promise.resolve({\n        status: \'success\',\n        rules: [{\n          RuleID: "123123143243",\n          DID: "scope:dataset1"\n        }, {\n          RuleID: "127849dsgs",\n          DID: "scope:dataset2"\n        }]\n      });\n    },\n    didListComDOM: mockUseComDOM(Array.from({\n      length: 100\n    }, () => fixtureListDIDViewModel())),\n    didValidation: (query: TypedDIDValidationQuery) => {\n      // if the DID contains the string "error", it will be added to the error list\n      var localErrorDIDs: TypedDIDValidationResponse = {\n        ErrorList: []\n      };\n      query.DIDList.map((DID: string, index: number) => {\n        if (DID.includes("error")) {\n          localErrorDIDs.ErrorList.push({\n            DID: DID,\n            ErrorCodes: [421],\n            Message: "This DID is invalid"\n          });\n        }\n      });\n      // if the error list is empty, the promise will resolve, otherwise it will reject\n      if (localErrorDIDs.ErrorList.length === 0) {\n        return Promise.resolve(localErrorDIDs);\n      } else {\n        return Promise.reject(localErrorDIDs);\n      }\n    },\n    rseListComDOM: mockUseComDOM(Array.from({\n      length: 100\n    }, () => fixtureRSEAccountUsageLimitViewModel()))\n  }\n}',...CreateRule.parameters?.docs?.source}}};const __namedExportsOrder=["CreateRule"]}}]);