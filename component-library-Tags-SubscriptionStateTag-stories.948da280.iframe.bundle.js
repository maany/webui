"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[8217],{"./node_modules/@babel/runtime/helpers/esm/defineProperty.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _typeof(o){return _typeof="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(o){return typeof o}:function(o){return o&&"function"==typeof Symbol&&o.constructor===Symbol&&o!==Symbol.prototype?"symbol":typeof o},_typeof(o)}function toPropertyKey(t){var i=function toPrimitive(t,r){if("object"!=_typeof(t)||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||"default");if("object"!=_typeof(i))return i;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===r?String:Number)(t)}(t,"string");return"symbol"==_typeof(i)?i:String(i)}function _defineProperty(obj,key,value){return(key=toPropertyKey(key))in obj?Object.defineProperty(obj,key,{value,enumerable:!0,configurable:!0,writable:!0}):obj[key]=value,obj}__webpack_require__.d(__webpack_exports__,{Z:()=>_defineProperty})},"./node_modules/@babel/runtime/helpers/esm/extends.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _extends(){return _extends=Object.assign?Object.assign.bind():function(target){for(var i=1;i<arguments.length;i++){var source=arguments[i];for(var key in source)Object.prototype.hasOwnProperty.call(source,key)&&(target[key]=source[key])}return target},_extends.apply(this,arguments)}__webpack_require__.d(__webpack_exports__,{Z:()=>_extends})},"./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _objectWithoutProperties(source,excluded){if(null==source)return{};var key,i,target=function _objectWithoutPropertiesLoose(source,excluded){if(null==source)return{};var key,i,target={},sourceKeys=Object.keys(source);for(i=0;i<sourceKeys.length;i++)key=sourceKeys[i],excluded.indexOf(key)>=0||(target[key]=source[key]);return target}(source,excluded);if(Object.getOwnPropertySymbols){var sourceSymbolKeys=Object.getOwnPropertySymbols(source);for(i=0;i<sourceSymbolKeys.length;i++)key=sourceSymbolKeys[i],excluded.indexOf(key)>=0||Object.prototype.propertyIsEnumerable.call(source,key)&&(target[key]=source[key])}return target}__webpack_require__.d(__webpack_exports__,{Z:()=>_objectWithoutProperties})},"./src/component-library/Tags/SubscriptionStateTag.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{SubscriptionStateTag:()=>SubscriptionStateTag,__namedExportsOrder:()=>__namedExportsOrder,default:()=>__WEBPACK_DEFAULT_EXPORT__});var react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),_SubscriptionStateTag__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/component-library/Tags/SubscriptionStateTag.tsx"),__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement;const __WEBPACK_DEFAULT_EXPORT__={title:"Components/Tags",component:_SubscriptionStateTag__WEBPACK_IMPORTED_MODULE_1__.H};var Template=function Template(args){return __jsx(_SubscriptionStateTag__WEBPACK_IMPORTED_MODULE_1__.H,args)};Template.displayName="Template";var SubscriptionStateTag=Template.bind({});SubscriptionStateTag.args={},SubscriptionStateTag.parameters={...SubscriptionStateTag.parameters,docs:{...SubscriptionStateTag.parameters?.docs,source:{originalSource:"args => <S {...args} />",...SubscriptionStateTag.parameters?.docs?.source}}};const __namedExportsOrder=["SubscriptionStateTag"]},"./src/component-library/Tags/SubscriptionStateTag.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{H:()=>SubscriptionStateTag});var _home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_4__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/extends.js"),_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/defineProperty.js"),_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js"),react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/lib/core/entity/rucio.ts"),tailwind_merge__WEBPACK_IMPORTED_MODULE_5__=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),_excluded=["state","tiny"],_excluded2=["className"],__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement,SubscriptionStateTag=function SubscriptionStateTag(_ref){var _stateStrings,_ref$state=_ref.state,state=void 0===_ref$state?_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.ACTIVE:_ref$state,_ref$tiny=_ref.tiny,tiny=void 0!==_ref$tiny&&_ref$tiny,props=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__.Z)(_ref,_excluded),className=props.className,otherprops=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__.Z)(props,_excluded2),stateStrings=(_stateStrings={},(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stateStrings,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.ACTIVE,["Active","A"]),(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stateStrings,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.INACTIVE,["Inactive","I"]),(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stateStrings,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.NEW,["New","N"]),(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stateStrings,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.UPDATED,["Updated","U"]),(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stateStrings,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.BROKEN,["Broken","B"]),(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stateStrings,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.UNKNOWN,["Unknown","?"]),_stateStrings);return __jsx("span",(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_4__.Z)({className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_5__.m)(state===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.ACTIVE?"bg-brand-300 border-brand-700 dark:bg-brand-700 dark:border-brand-200":state===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.INACTIVE?"bg-neutral-300 border-neutral-700 dark:bg-neutral-700 dark:border-neutral-200":state===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.NEW?"bg-base-info-300 border-base-info-700 dark:bg-base-info-700 dark:border-base-info-200":state===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jc.UPDATED?"bg-base-success-300 border-base-success-700 dark:bg-base-success-700 dark:border-base-success-200":"bg-base-error-300 border-base-error-700 dark:bg-base-error-700 dark:border-base-error-200","text-text-1000 dark:text-text-0",tiny?"w-6 h-6 rounded-full border text-center select-none shrink-0":"w-24 rounded border text-center","flex justify-center items-center",null!=className?className:"")},otherprops),tiny?stateStrings[state][1]:stateStrings[state][0])};SubscriptionStateTag.displayName="SubscriptionStateTag";try{SubscriptionStateTag.displayName="SubscriptionStateTag",SubscriptionStateTag.__docgenInfo={description:"",displayName:"SubscriptionStateTag",props:{state:{defaultValue:{value:"SubscriptionState.ACTIVE"},description:"",name:"state",required:!1,type:{name:"enum",value:[{value:'"A"'},{value:'"I"'},{value:'"N"'},{value:'"U"'},{value:'"B"'},{value:'"UNKNOWN"'}]}},tiny:{defaultValue:{value:"false"},description:"",name:"tiny",required:!1,type:{name:"boolean"}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Tags/SubscriptionStateTag.tsx#SubscriptionStateTag"]={docgenInfo:SubscriptionStateTag.__docgenInfo,name:"SubscriptionStateTag",path:"src/component-library/Tags/SubscriptionStateTag.tsx#SubscriptionStateTag"})}catch(__react_docgen_typescript_loader_error){}},"./src/lib/core/entity/rucio.ts":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{Ik:()=>LockState,N0:()=>RuleNotification,Qm:()=>AccountType,b9:()=>DIDType,cp:()=>ReplicaState,dp:()=>AccountStatus,jG:()=>DIDAvailability,jc:()=>SubscriptionState,mi:()=>RSEType,pJ:()=>RuleState});var AccountStatus=function(AccountStatus){return AccountStatus.ACTIVE="ACTIVE",AccountStatus.SUSPENDED="SUSPENDED",AccountStatus.DELETED="DELETED",AccountStatus.UNKNOWN="UNKNOWN",AccountStatus}({}),AccountType=function(AccountType){return AccountType.USER="USER",AccountType.GROUP="GROUP",AccountType.SERVICE="SERVICE",AccountType.UNKNOWN="UNKNOWN",AccountType}({}),DIDAvailability=function(DIDAvailability){return DIDAvailability.AVAILABLE="Available",DIDAvailability.DELETED="Deleted",DIDAvailability.LOST="Lost",DIDAvailability.UNKNOWN="Unknown",DIDAvailability}({}),LockState=function(LockState){return LockState.REPLICATING="R",LockState.OK="O",LockState.STUCK="S",LockState.UNKNOWN="U",LockState}({}),RuleNotification=function(RuleNotification){return RuleNotification.Yes="Y",RuleNotification.No="N",RuleNotification.Close="C",RuleNotification.Progress="P",RuleNotification}({}),DIDType=function(DIDType){return DIDType.DATASET="Dataset",DIDType.CONTAINER="Container",DIDType.COLLECTION="Collection",DIDType.FILE="File",DIDType.ALL="All",DIDType.UNKNOWN="Unknown",DIDType.DERIVED="Derived",DIDType}({}),RSEType=function(RSEType){return RSEType.DISK="DISK",RSEType.TAPE="TAPE",RSEType.UNKNOWN="UNKNOWN",RSEType}({}),ReplicaState=function(ReplicaState){return ReplicaState.AVAILABLE="Available",ReplicaState.UNAVAILABLE="Unavailable",ReplicaState.COPYING="Copying",ReplicaState.BEING_DELETED="Being_Deleted",ReplicaState.BAD="Bad",ReplicaState.TEMPORARY_UNAVAILABLE="Temporary_Unavailable",ReplicaState.UNKNOWN="Unknown",ReplicaState}({}),RuleState=function(RuleState){return RuleState.REPLICATING="Replicating",RuleState.OK="OK",RuleState.STUCK="Stuck",RuleState.SUSPENDED="Suspended",RuleState.WAITING_APPROVAL="Waiting_Approval",RuleState.INJECT="Inject",RuleState.UNKNOWN="Unknown",RuleState}({}),SubscriptionState=function(SubscriptionState){return SubscriptionState.ACTIVE="A",SubscriptionState.INACTIVE="I",SubscriptionState.NEW="N",SubscriptionState.UPDATED="U",SubscriptionState.BROKEN="B",SubscriptionState.UNKNOWN="UNKNOWN",SubscriptionState}({})}}]);