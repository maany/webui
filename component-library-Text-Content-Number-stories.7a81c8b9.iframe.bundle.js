"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[5242],{"./node_modules/@babel/runtime/helpers/esm/extends.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _extends(){return _extends=Object.assign?Object.assign.bind():function(target){for(var i=1;i<arguments.length;i++){var source=arguments[i];for(var key in source)Object.prototype.hasOwnProperty.call(source,key)&&(target[key]=source[key])}return target},_extends.apply(this,arguments)}__webpack_require__.d(__webpack_exports__,{Z:()=>_extends})},"./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _objectWithoutProperties(source,excluded){if(null==source)return{};var key,i,target=function _objectWithoutPropertiesLoose(source,excluded){if(null==source)return{};var key,i,target={},sourceKeys=Object.keys(source);for(i=0;i<sourceKeys.length;i++)key=sourceKeys[i],excluded.indexOf(key)>=0||(target[key]=source[key]);return target}(source,excluded);if(Object.getOwnPropertySymbols){var sourceSymbolKeys=Object.getOwnPropertySymbols(source);for(i=0;i<sourceSymbolKeys.length;i++)key=sourceSymbolKeys[i],excluded.indexOf(key)>=0||Object.prototype.propertyIsEnumerable.call(source,key)&&(target[key]=source[key])}return target}__webpack_require__.d(__webpack_exports__,{Z:()=>_objectWithoutProperties})},"./src/component-library/Text/Content/Number.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{Number:()=>Number,__namedExportsOrder:()=>__namedExportsOrder,default:()=>__WEBPACK_DEFAULT_EXPORT__});var react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),_Number__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/component-library/Text/Content/Number.tsx"),__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement;const __WEBPACK_DEFAULT_EXPORT__={title:"Components/Text/Content",component:_Number__WEBPACK_IMPORTED_MODULE_1__.M};var Template=function Template(args){return __jsx(_Number__WEBPACK_IMPORTED_MODULE_1__.M,args)};Template.displayName="Template";var Number=Template.bind({});Number.args={number:2e3,decimalPlaces:2},Number.parameters={...Number.parameters,docs:{...Number.parameters?.docs,source:{originalSource:"args => <L {...args} />",...Number.parameters?.docs?.source}}};const __namedExportsOrder=["Number"]},"./src/component-library/Text/Content/Number.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{M:()=>Number});var _home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/extends.js"),_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js"),react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),tailwind_merge__WEBPACK_IMPORTED_MODULE_3__=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),_excluded=["number","decimalPlaces"],_excluded2=["className"],__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement,Number=function Number(_ref){var number=_ref.number,decimalPlaces=_ref.decimalPlaces,props=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__.Z)(_ref,_excluded),className=props.className,otherprops=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__.Z)(props,_excluded2);if(0===number)return __jsx("span",(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__.Z)({className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_3__.m)(null!=className?className:"")},otherprops),"0");if(number===1/0)return __jsx("span",(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__.Z)({className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_3__.m)(null!=className?className:"","text-base-warning-500 text-bold")},otherprops),"Infinity");if(isNaN(+number))return __jsx("span",(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__.Z)({className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_3__.m)(null!=className?className:"","text-base-error-500 text-bold")},otherprops),"NaN");var dm=null!=decimalPlaces?decimalPlaces:1,absnum=Math.abs(number),i=Math.floor(Math.log(absnum)/Math.log(1e3));return __jsx("span",(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__.Z)({className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_3__.m)(null!=className?className:"")},otherprops),number<0?"-":"","".concat(parseFloat((absnum/Math.pow(1e3,i)).toFixed(dm))," ").concat(["Bytes","KB","MB","GB","TB","PB","EB","ZB","YB"][i]))};Number.displayName="Number";try{Number.displayName="Number",Number.__docgenInfo={description:"",displayName:"Number",props:{number:{defaultValue:null,description:"",name:"number",required:!0,type:{name:"number"}},decimalPlaces:{defaultValue:null,description:"",name:"decimalPlaces",required:!1,type:{name:"number"}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Text/Content/Number.tsx#Number"]={docgenInfo:Number.__docgenInfo,name:"Number",path:"src/component-library/Text/Content/Number.tsx#Number"})}catch(__react_docgen_typescript_loader_error){}}}]);