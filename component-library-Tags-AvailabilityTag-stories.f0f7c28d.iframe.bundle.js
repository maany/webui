"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[1936],{"./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _objectWithoutProperties(source,excluded){if(null==source)return{};var key,i,target=function _objectWithoutPropertiesLoose(source,excluded){if(null==source)return{};var key,i,target={},sourceKeys=Object.keys(source);for(i=0;i<sourceKeys.length;i++)key=sourceKeys[i],excluded.indexOf(key)>=0||(target[key]=source[key]);return target}(source,excluded);if(Object.getOwnPropertySymbols){var sourceSymbolKeys=Object.getOwnPropertySymbols(source);for(i=0;i<sourceSymbolKeys.length;i++)key=sourceSymbolKeys[i],excluded.indexOf(key)>=0||Object.prototype.propertyIsEnumerable.call(source,key)&&(target[key]=source[key])}return target}__webpack_require__.d(__webpack_exports__,{Z:()=>_objectWithoutProperties})},"./src/component-library/Tags/AvailabilityTag.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{AvailabilityTag:()=>AvailabilityTag,__namedExportsOrder:()=>__namedExportsOrder,default:()=>__WEBPACK_DEFAULT_EXPORT__});var react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/lib/core/entity/rucio.ts"),_AvailabilityTag__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./src/component-library/Tags/AvailabilityTag.tsx"),__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement;const __WEBPACK_DEFAULT_EXPORT__={title:"Components/Tags",component:_AvailabilityTag__WEBPACK_IMPORTED_MODULE_2__.m};var Template=function Template(args){return __jsx(_AvailabilityTag__WEBPACK_IMPORTED_MODULE_2__.m,args)};Template.displayName="Template";var AvailabilityTag=Template.bind({});AvailabilityTag.args={availability:_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jG.AVAILABLE},AvailabilityTag.parameters={...AvailabilityTag.parameters,docs:{...AvailabilityTag.parameters?.docs,source:{originalSource:"args => <A {...args} />",...AvailabilityTag.parameters?.docs?.source}}};const __namedExportsOrder=["AvailabilityTag"]},"./src/component-library/Tags/AvailabilityTag.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{m:()=>AvailabilityTag});var _home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js"),react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),tailwind_merge__WEBPACK_IMPORTED_MODULE_3__=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/lib/core/entity/rucio.ts"),_excluded=["availability"],__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement,AvailabilityTag=function AvailabilityTag(_ref){var _ref$availability=_ref.availability,availability=void 0===_ref$availability?"Available":_ref$availability;(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_2__.Z)(_ref,_excluded);return __jsx("span",{className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_3__.m)(availability===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jG.AVAILABLE?"bg-base-success-200 dark:bg-base-success-700":availability===_lib_core_entity_rucio__WEBPACK_IMPORTED_MODULE_1__.jG.DELETED?"bg-neutral-200 dark:bg-neutral-700":"bg-brand-200 dark:bg-brand-700","text-text-1000 dark:text-text-0 italic","w-24 h-6 rounded text-center select-none","flex flex-row justify-center items-center")},availability)};AvailabilityTag.displayName="AvailabilityTag";try{AvailabilityTag.displayName="AvailabilityTag",AvailabilityTag.__docgenInfo={description:"",displayName:"AvailabilityTag",props:{availability:{defaultValue:{value:"Available"},description:"",name:"availability",required:!1,type:{name:"enum",value:[{value:'"Available"'},{value:'"Deleted"'},{value:'"Lost"'},{value:'"Unknown"'}]}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Tags/AvailabilityTag.tsx#AvailabilityTag"]={docgenInfo:AvailabilityTag.__docgenInfo,name:"AvailabilityTag",path:"src/component-library/Tags/AvailabilityTag.tsx#AvailabilityTag"})}catch(__react_docgen_typescript_loader_error){}},"./src/lib/core/entity/rucio.ts":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{Ik:()=>LockState,N0:()=>RuleNotification,Qm:()=>AccountType,b9:()=>DIDType,cp:()=>ReplicaState,dp:()=>AccountStatus,jG:()=>DIDAvailability,jc:()=>SubscriptionState,mi:()=>RSEType,pJ:()=>RuleState});var AccountStatus=function(AccountStatus){return AccountStatus.ACTIVE="ACTIVE",AccountStatus.SUSPENDED="SUSPENDED",AccountStatus.DELETED="DELETED",AccountStatus.UNKNOWN="UNKNOWN",AccountStatus}({}),AccountType=function(AccountType){return AccountType.USER="USER",AccountType.GROUP="GROUP",AccountType.SERVICE="SERVICE",AccountType.UNKNOWN="UNKNOWN",AccountType}({}),DIDAvailability=function(DIDAvailability){return DIDAvailability.AVAILABLE="Available",DIDAvailability.DELETED="Deleted",DIDAvailability.LOST="Lost",DIDAvailability.UNKNOWN="Unknown",DIDAvailability}({}),LockState=function(LockState){return LockState.REPLICATING="R",LockState.OK="O",LockState.STUCK="S",LockState.UNKNOWN="U",LockState}({}),RuleNotification=function(RuleNotification){return RuleNotification.Yes="Y",RuleNotification.No="N",RuleNotification.Close="C",RuleNotification.Progress="P",RuleNotification}({}),DIDType=function(DIDType){return DIDType.DATASET="Dataset",DIDType.CONTAINER="Container",DIDType.COLLECTION="Collection",DIDType.FILE="File",DIDType.ALL="All",DIDType.UNKNOWN="Unknown",DIDType.DERIVED="Derived",DIDType}({}),RSEType=function(RSEType){return RSEType.DISK="DISK",RSEType.TAPE="TAPE",RSEType.UNKNOWN="UNKNOWN",RSEType}({}),ReplicaState=function(ReplicaState){return ReplicaState.AVAILABLE="Available",ReplicaState.UNAVAILABLE="Unavailable",ReplicaState.COPYING="Copying",ReplicaState.BEING_DELETED="Being_Deleted",ReplicaState.BAD="Bad",ReplicaState.TEMPORARY_UNAVAILABLE="Temporary_Unavailable",ReplicaState.UNKNOWN="Unknown",ReplicaState}({}),RuleState=function(RuleState){return RuleState.REPLICATING="Replicating",RuleState.OK="OK",RuleState.STUCK="Stuck",RuleState.SUSPENDED="Suspended",RuleState.WAITING_APPROVAL="Waiting_Approval",RuleState.INJECT="Inject",RuleState.UNKNOWN="Unknown",RuleState}({}),SubscriptionState=function(SubscriptionState){return SubscriptionState.ACTIVE="A",SubscriptionState.INACTIVE="I",SubscriptionState.NEW="N",SubscriptionState.UPDATED="U",SubscriptionState.BROKEN="B",SubscriptionState.UNKNOWN="UNKNOWN",SubscriptionState}({})}}]);