"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[3965],{"./node_modules/@babel/runtime/helpers/esm/defineProperty.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _typeof(o){return _typeof="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(o){return typeof o}:function(o){return o&&"function"==typeof Symbol&&o.constructor===Symbol&&o!==Symbol.prototype?"symbol":typeof o},_typeof(o)}function toPropertyKey(t){var i=function toPrimitive(t,r){if("object"!=_typeof(t)||!t)return t;var e=t[Symbol.toPrimitive];if(void 0!==e){var i=e.call(t,r||"default");if("object"!=_typeof(i))return i;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===r?String:Number)(t)}(t,"string");return"symbol"==_typeof(i)?i:String(i)}function _defineProperty(obj,key,value){return(key=toPropertyKey(key))in obj?Object.defineProperty(obj,key,{value,enumerable:!0,configurable:!0,writable:!0}):obj[key]=value,obj}__webpack_require__.d(__webpack_exports__,{Z:()=>_defineProperty})},"./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _objectWithoutProperties(source,excluded){if(null==source)return{};var key,i,target=function _objectWithoutPropertiesLoose(source,excluded){if(null==source)return{};var key,i,target={},sourceKeys=Object.keys(source);for(i=0;i<sourceKeys.length;i++)key=sourceKeys[i],excluded.indexOf(key)>=0||(target[key]=source[key]);return target}(source,excluded);if(Object.getOwnPropertySymbols){var sourceSymbolKeys=Object.getOwnPropertySymbols(source);for(i=0;i<sourceSymbolKeys.length;i++)key=sourceSymbolKeys[i],excluded.indexOf(key)>=0||Object.prototype.propertyIsEnumerable.call(source,key)&&(target[key]=source[key])}return target}__webpack_require__.d(__webpack_exports__,{Z:()=>_objectWithoutProperties})},"./src/component-library/Tags/RSETypeTag.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{RSETypeTag:()=>RSETypeTag,__namedExportsOrder:()=>__namedExportsOrder,default:()=>__WEBPACK_DEFAULT_EXPORT__});var react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),_RSETypeTag__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/component-library/Tags/RSETypeTag.tsx"),__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement;const __WEBPACK_DEFAULT_EXPORT__={title:"Components/Tags",component:_RSETypeTag__WEBPACK_IMPORTED_MODULE_1__.d};var Template=function Template(args){return __jsx(_RSETypeTag__WEBPACK_IMPORTED_MODULE_1__.d,args)};Template.displayName="Template";var RSETypeTag=Template.bind({});RSETypeTag.args={},RSETypeTag.parameters={...RSETypeTag.parameters,docs:{...RSETypeTag.parameters?.docs,source:{originalSource:"args => <R {...args} />",...RSETypeTag.parameters?.docs?.source}}};const __namedExportsOrder=["RSETypeTag"]},"./src/component-library/Tags/RSETypeTag.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{d:()=>RSETypeTag});var _home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/defineProperty.js"),_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js"),react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),tailwind_merge__WEBPACK_IMPORTED_MODULE_4__=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/lib/core/entity/rucio.ts"),_excluded=["rsetype","neversmall","forcesmall"],_excluded2=["className"],__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement,RSETypeTag=function RSETypeTag(_ref){var _stringMatch,_ref$rsetype=_ref.rsetype,rsetype=void 0===_ref$rsetype?_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.mi.DISK:_ref$rsetype,_ref$neversmall=_ref.neversmall,neversmall=void 0!==_ref$neversmall&&_ref$neversmall,_ref$forcesmall=_ref.forcesmall,forcesmall=void 0!==_ref$forcesmall&&_ref$forcesmall,props=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__.Z)(_ref,_excluded),className=props.className,_useState=((0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__.Z)(props,_excluded2),(0,react__WEBPACK_IMPORTED_MODULE_0__.useState)(720)),windowWidth=_useState[0],setWindowWidth=_useState[1];(0,react__WEBPACK_IMPORTED_MODULE_0__.useEffect)((function(){var handleResize=function handleResize(){return setWindowWidth(window.innerWidth)};handleResize(),window.addEventListener("resize",handleResize)}),[]);var belowMedium=windowWidth<768||forcesmall,stringMatch=(_stringMatch={},(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stringMatch,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.mi.DISK,"Disk"),(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stringMatch,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.mi.TAPE,"Tape"),(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_defineProperty_js__WEBPACK_IMPORTED_MODULE_3__.Z)(_stringMatch,_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.mi.UNKNOWN,"Unknown"),_stringMatch);return __jsx("span",{className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_4__.m)("h-6 rounded text-center flex justify-center items-center","font-bold",neversmall?"w-24":"w-6 md:w-24 rounded-full md:rounded",forcesmall?"w-6 md:w-6 rounded-full md:rounded-full":"",rsetype===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.mi.DISK?"bg-extra-emerald-100 text-extra-emerald-800 dark:bg-extra-emerald-900 dark:text-extra-emerald-300":rsetype===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.mi.TAPE?"bg-extra-rose-100 text-extra-rose-800 dark:bg-extra-rose-900 dark:text-extra-rose-300":"",null!=className?className:"")},belowMedium&&!neversmall?stringMatch[rsetype].slice(0,1):stringMatch[rsetype])};RSETypeTag.displayName="RSETypeTag";try{RSETypeTag.displayName="RSETypeTag",RSETypeTag.__docgenInfo={description:"",displayName:"RSETypeTag",props:{rsetype:{defaultValue:{value:"RSEType.DISK"},description:"",name:"rsetype",required:!1,type:{name:"enum",value:[{value:'"DISK"'},{value:'"TAPE"'},{value:'"UNKNOWN"'}]}},forcesmall:{defaultValue:{value:"false"},description:"",name:"forcesmall",required:!1,type:{name:"boolean"}},neversmall:{defaultValue:{value:"false"},description:"",name:"neversmall",required:!1,type:{name:"boolean"}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Tags/RSETypeTag.tsx#RSETypeTag"]={docgenInfo:RSETypeTag.__docgenInfo,name:"RSETypeTag",path:"src/component-library/Tags/RSETypeTag.tsx#RSETypeTag"})}catch(__react_docgen_typescript_loader_error){}},"./src/lib/core/entity/rucio.ts":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{Ik:()=>LockState,N0:()=>RuleNotification,Qm:()=>AccountType,b9:()=>DIDType,cp:()=>ReplicaState,dp:()=>AccountStatus,jG:()=>DIDAvailability,jc:()=>SubscriptionState,mi:()=>RSEType,pJ:()=>RuleState});var AccountStatus=function(AccountStatus){return AccountStatus.ACTIVE="ACTIVE",AccountStatus.SUSPENDED="SUSPENDED",AccountStatus.DELETED="DELETED",AccountStatus.UNKNOWN="UNKNOWN",AccountStatus}({}),AccountType=function(AccountType){return AccountType.USER="USER",AccountType.GROUP="GROUP",AccountType.SERVICE="SERVICE",AccountType.UNKNOWN="UNKNOWN",AccountType}({}),DIDAvailability=function(DIDAvailability){return DIDAvailability.AVAILABLE="Available",DIDAvailability.DELETED="Deleted",DIDAvailability.LOST="Lost",DIDAvailability.UNKNOWN="Unknown",DIDAvailability}({}),LockState=function(LockState){return LockState.REPLICATING="R",LockState.OK="O",LockState.STUCK="S",LockState.UNKNOWN="U",LockState}({}),RuleNotification=function(RuleNotification){return RuleNotification.Yes="Y",RuleNotification.No="N",RuleNotification.Close="C",RuleNotification.Progress="P",RuleNotification}({}),DIDType=function(DIDType){return DIDType.DATASET="Dataset",DIDType.CONTAINER="Container",DIDType.COLLECTION="Collection",DIDType.FILE="File",DIDType.ALL="All",DIDType.UNKNOWN="Unknown",DIDType.DERIVED="Derived",DIDType}({}),RSEType=function(RSEType){return RSEType.DISK="DISK",RSEType.TAPE="TAPE",RSEType.UNKNOWN="UNKNOWN",RSEType}({}),ReplicaState=function(ReplicaState){return ReplicaState.AVAILABLE="Available",ReplicaState.UNAVAILABLE="Unavailable",ReplicaState.COPYING="Copying",ReplicaState.BEING_DELETED="Being_Deleted",ReplicaState.BAD="Bad",ReplicaState.TEMPORARY_UNAVAILABLE="Temporary_Unavailable",ReplicaState.UNKNOWN="Unknown",ReplicaState}({}),RuleState=function(RuleState){return RuleState.REPLICATING="Replicating",RuleState.OK="OK",RuleState.STUCK="Stuck",RuleState.SUSPENDED="Suspended",RuleState.WAITING_APPROVAL="Waiting_Approval",RuleState.INJECT="Inject",RuleState.UNKNOWN="Unknown",RuleState}({}),SubscriptionState=function(SubscriptionState){return SubscriptionState.ACTIVE="A",SubscriptionState.INACTIVE="I",SubscriptionState.NEW="N",SubscriptionState.UPDATED="U",SubscriptionState.BROKEN="B",SubscriptionState.UNKNOWN="UNKNOWN",SubscriptionState}({})}}]);