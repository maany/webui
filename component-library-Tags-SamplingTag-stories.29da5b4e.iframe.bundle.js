"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[3450],{"./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _objectWithoutProperties(source,excluded){if(null==source)return{};var key,i,target=function _objectWithoutPropertiesLoose(source,excluded){if(null==source)return{};var key,i,target={},sourceKeys=Object.keys(source);for(i=0;i<sourceKeys.length;i++)key=sourceKeys[i],excluded.indexOf(key)>=0||(target[key]=source[key]);return target}(source,excluded);if(Object.getOwnPropertySymbols){var sourceSymbolKeys=Object.getOwnPropertySymbols(source);for(i=0;i<sourceSymbolKeys.length;i++)key=sourceSymbolKeys[i],excluded.indexOf(key)>=0||Object.prototype.propertyIsEnumerable.call(source,key)&&(target[key]=source[key])}return target}__webpack_require__.d(__webpack_exports__,{Z:()=>_objectWithoutProperties})},"./src/component-library/Tags/SamplingTag.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{SamplingTag:()=>SamplingTag,__namedExportsOrder:()=>__namedExportsOrder,default:()=>__WEBPACK_DEFAULT_EXPORT__});var react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),_SamplingTag__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/component-library/Tags/SamplingTag.tsx"),__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement;const __WEBPACK_DEFAULT_EXPORT__={title:"Components/Tags",component:_SamplingTag__WEBPACK_IMPORTED_MODULE_1__.H};var Template=function Template(args){return __jsx(_SamplingTag__WEBPACK_IMPORTED_MODULE_1__.H,args)};Template.displayName="Template";var SamplingTag=Template.bind({});SamplingTag.args={sampling:!0},SamplingTag.parameters={...SamplingTag.parameters,docs:{...SamplingTag.parameters?.docs,source:{originalSource:"args => <S {...args} />",...SamplingTag.parameters?.docs?.source}}};const __namedExportsOrder=["SamplingTag"]},"./src/component-library/Tags/SamplingTag.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{H:()=>SamplingTag});var _home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js"),react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),tailwind_merge__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),_excluded=["sampling"],__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement,SamplingTag=function SamplingTag(_ref){var _ref$sampling=_ref.sampling,sampling=void 0!==_ref$sampling&&_ref$sampling;(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__.Z)(_ref,_excluded);return __jsx("span",{className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_2__.m)("bg-brand-300 dark:bg-brand-600","text-text-1000 dark:text-text-0 font-bold","w-6 md:w-24 rounded text-center select-none","flex justify-center items-center",sampling?"flex":"hidden")},"Sampling")};SamplingTag.displayName="SamplingTag";try{SamplingTag.displayName="SamplingTag",SamplingTag.__docgenInfo={description:"",displayName:"SamplingTag",props:{sampling:{defaultValue:{value:"false"},description:"",name:"sampling",required:!1,type:{name:"boolean"}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Tags/SamplingTag.tsx#SamplingTag"]={docgenInfo:SamplingTag.__docgenInfo,name:"SamplingTag",path:"src/component-library/Tags/SamplingTag.tsx#SamplingTag"})}catch(__react_docgen_typescript_loader_error){}}}]);