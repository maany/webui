"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[5325],{"./node_modules/@babel/runtime/helpers/esm/extends.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _extends(){return _extends=Object.assign?Object.assign.bind():function(target){for(var i=1;i<arguments.length;i++){var source=arguments[i];for(var key in source)Object.prototype.hasOwnProperty.call(source,key)&&(target[key]=source[key])}return target},_extends.apply(this,arguments)}__webpack_require__.d(__webpack_exports__,{Z:()=>_extends})},"./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _objectWithoutProperties(source,excluded){if(null==source)return{};var key,i,target=function _objectWithoutPropertiesLoose(source,excluded){if(null==source)return{};var key,i,target={},sourceKeys=Object.keys(source);for(i=0;i<sourceKeys.length;i++)key=sourceKeys[i],excluded.indexOf(key)>=0||(target[key]=source[key]);return target}(source,excluded);if(Object.getOwnPropertySymbols){var sourceSymbolKeys=Object.getOwnPropertySymbols(source);for(i=0;i<sourceSymbolKeys.length;i++)key=sourceSymbolKeys[i],excluded.indexOf(key)>=0||Object.prototype.propertyIsEnumerable.call(source,key)&&(target[key]=source[key])}return target}__webpack_require__.d(__webpack_exports__,{Z:()=>_objectWithoutProperties})},"./src/component-library/Input/TextInput.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{TextInput:()=>TextInput,__namedExportsOrder:()=>__namedExportsOrder,default:()=>__WEBPACK_DEFAULT_EXPORT__});var react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),_TextInput__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./src/component-library/Input/TextInput.tsx"),__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement;const __WEBPACK_DEFAULT_EXPORT__={title:"Components/Input",component:_TextInput__WEBPACK_IMPORTED_MODULE_1__.o};var Template=function Template(args){return __jsx(_TextInput__WEBPACK_IMPORTED_MODULE_1__.o,args)};Template.displayName="Template";var TextInput=Template.bind({});TextInput.args={children:void 0,placeholder:"Placeholder String"},TextInput.parameters={...TextInput.parameters,docs:{...TextInput.parameters?.docs,source:{originalSource:"args => <TI {...args} />",...TextInput.parameters?.docs?.source}}};const __namedExportsOrder=["TextInput"]},"./src/component-library/Input/TextInput.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{o:()=>TextInput});var _home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/extends.js"),_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js"),react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),tailwind_merge__WEBPACK_IMPORTED_MODULE_3__=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),_excluded=["onEnterkey"],_excluded2=["className","children","onKeyDown"],__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement,TextInput=function TextInput(_ref){var _props$className,onEnterkey=_ref.onEnterkey,props=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__.Z)(_ref,_excluded),children=(props.className,props.children),_onKeyDown=props.onKeyDown,otherprops=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__.Z)(props,_excluded2);return __jsx("input",(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__.Z)({className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_3__.m)("w-full h-8 px-2 pt-2 ","dark:border-neutral-400 dark:bg-neutral-800 bg-neutral-0 text-text-1000 dark:text-text-0 ","border rounded-sm","dark:border-2 dark:border-neutral-0",null!==(_props$className=props.className)&&void 0!==_props$className?_props$className:""),onKeyDown:function onKeyDown(e){"Enter"===e.key&&(null==onEnterkey||onEnterkey(e)),null==_onKeyDown||_onKeyDown(e)}},otherprops),children)};TextInput.displayName="TextInput";try{TextInput.displayName="TextInput",TextInput.__docgenInfo={description:"",displayName:"TextInput",props:{onEnterkey:{defaultValue:null,description:"",name:"onEnterkey",required:!1,type:{name:"((event: any) => void)"}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Input/TextInput.tsx#TextInput"]={docgenInfo:TextInput.__docgenInfo,name:"TextInput",path:"src/component-library/Input/TextInput.tsx#TextInput"})}catch(__react_docgen_typescript_loader_error){}}}]);