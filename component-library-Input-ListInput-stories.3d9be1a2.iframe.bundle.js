"use strict";(self.webpackChunkrucio_webui=self.webpackChunkrucio_webui||[]).push([[8384],{"./node_modules/@babel/runtime/helpers/esm/extends.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _extends(){return _extends=Object.assign?Object.assign.bind():function(target){for(var i=1;i<arguments.length;i++){var source=arguments[i];for(var key in source)Object.prototype.hasOwnProperty.call(source,key)&&(target[key]=source[key])}return target},_extends.apply(this,arguments)}__webpack_require__.d(__webpack_exports__,{Z:()=>_extends})},"./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{function _objectWithoutProperties(source,excluded){if(null==source)return{};var key,i,target=function _objectWithoutPropertiesLoose(source,excluded){if(null==source)return{};var key,i,target={},sourceKeys=Object.keys(source);for(i=0;i<sourceKeys.length;i++)key=sourceKeys[i],excluded.indexOf(key)>=0||(target[key]=source[key]);return target}(source,excluded);if(Object.getOwnPropertySymbols){var sourceSymbolKeys=Object.getOwnPropertySymbols(source);for(i=0;i<sourceSymbolKeys.length;i++)key=sourceSymbolKeys[i],excluded.indexOf(key)>=0||Object.prototype.propertyIsEnumerable.call(source,key)&&(target[key]=source[key])}return target}__webpack_require__.d(__webpack_exports__,{Z:()=>_objectWithoutProperties})},"./src/component-library/Input/ListInput.stories.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.r(__webpack_exports__),__webpack_require__.d(__webpack_exports__,{ListInput:()=>ListInput_stories_ListInput,__namedExportsOrder:()=>__namedExportsOrder,default:()=>ListInput_stories});var react=__webpack_require__("./node_modules/next/dist/compiled/react/index.js");function _arrayLikeToArray(arr,len){(null==len||len>arr.length)&&(len=arr.length);for(var i=0,arr2=new Array(len);i<len;i++)arr2[i]=arr[i];return arr2}function _toConsumableArray(arr){return function _arrayWithoutHoles(arr){if(Array.isArray(arr))return _arrayLikeToArray(arr)}(arr)||function _iterableToArray(iter){if("undefined"!=typeof Symbol&&null!=iter[Symbol.iterator]||null!=iter["@@iterator"])return Array.from(iter)}(arr)||function _unsupportedIterableToArray(o,minLen){if(o){if("string"==typeof o)return _arrayLikeToArray(o,minLen);var n=Object.prototype.toString.call(o).slice(8,-1);return"Object"===n&&o.constructor&&(n=o.constructor.name),"Map"===n||"Set"===n?Array.from(o):"Arguments"===n||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?_arrayLikeToArray(o,minLen):void 0}}(arr)||function _nonIterableSpread(){throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}var TextInput=__webpack_require__("./src/component-library/Input/TextInput.tsx"),index_esm=__webpack_require__("./node_modules/react-icons/hi/index.esm.js"),tw_merge=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),__jsx=react.createElement,ListInput=function ListInput(props){var _useState=(0,react.useState)(props.value),items=_useState[0],setItems=_useState[1];(0,react.useEffect)((function(){setItems(props.value)}),[props.value]);return __jsx("div",{className:"w-full border dark:border-2 rounded-md"},__jsx("div",{className:"w-full flex flex-row"},__jsx(TextInput.o,{id:props.id,placeholder:props.placeholder,onEnterkey:function onEnterkey(e){var val=e.currentTarget.value;-1===items.indexOf(val)?(setItems([val].concat(_toConsumableArray(items))),props.onAdd(val),e.currentTarget.value=""):e.currentTarget.value=""}})),__jsx("div",{className:"w-full h-56 overflow-y-auto"},items.map((function(item){return function ClickableItem(item){return __jsx("div",{id:props.id,className:"w-full flex flex-row bg-neutral-0 hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-900"},__jsx("div",{className:"grow text-align-center"},__jsx("p",{className:"m-2 font-mono dark:text-text-0 text-text-1000"},item)),__jsx("div",{className:"w-12 p-1"},__jsx("button",{type:"reset",onClick:function onClick(){setItems(items.filter((function(i){return i!==item}))),props.onRemove(item)},className:(0,tw_merge.m)("w-full h-full flex justify-center items-center","text-base-error-500 hover:text-base-error-600")},__jsx(index_esm.VLi,{className:"text-3xl"}))))}(item)}))))};ListInput.displayName="ListInput";try{ListInput.displayName="ListInput",ListInput.__docgenInfo={description:"",displayName:"ListInput",props:{onAdd:{defaultValue:null,description:"",name:"onAdd",required:!0,type:{name:"(value: string) => void"}},onRemove:{defaultValue:null,description:"",name:"onRemove",required:!0,type:{name:"(value: string) => void"}},placeholder:{defaultValue:null,description:"",name:"placeholder",required:!0,type:{name:"string"}},value:{defaultValue:null,description:"",name:"value",required:!0,type:{name:"string[]"}},id:{defaultValue:null,description:"",name:"id",required:!1,type:{name:"string"}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Input/ListInput.tsx#ListInput"]={docgenInfo:ListInput.__docgenInfo,name:"ListInput",path:"src/component-library/Input/ListInput.tsx#ListInput"})}catch(__react_docgen_typescript_loader_error){}var ListInput_stories_jsx=react.createElement;const ListInput_stories={title:"Components/Input",component:ListInput};var Template=function Template(args){return ListInput_stories_jsx(ListInput,args)};Template.displayName="Template";var ListInput_stories_ListInput=Template.bind({});ListInput_stories_ListInput.args={onAdd:function onAdd(value){},onRemove:function onRemove(value){},placeholder:"Placeholder",value:[]},ListInput_stories_ListInput.parameters={...ListInput_stories_ListInput.parameters,docs:{...ListInput_stories_ListInput.parameters?.docs,source:{originalSource:"args => <LI {...args} />",...ListInput_stories_ListInput.parameters?.docs?.source}}};const __namedExportsOrder=["ListInput"]},"./src/component-library/Input/TextInput.tsx":(__unused_webpack_module,__webpack_exports__,__webpack_require__)=>{__webpack_require__.d(__webpack_exports__,{o:()=>TextInput});var _home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/extends.js"),_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__=__webpack_require__("./node_modules/@babel/runtime/helpers/esm/objectWithoutProperties.js"),react__WEBPACK_IMPORTED_MODULE_0__=__webpack_require__("./node_modules/next/dist/compiled/react/index.js"),tailwind_merge__WEBPACK_IMPORTED_MODULE_3__=__webpack_require__("./node_modules/tailwind-merge/dist/lib/tw-merge.mjs"),_excluded=["onEnterkey"],_excluded2=["className","children","onKeyDown"],__jsx=react__WEBPACK_IMPORTED_MODULE_0__.createElement,TextInput=function TextInput(_ref){var _props$className,onEnterkey=_ref.onEnterkey,props=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__.Z)(_ref,_excluded),children=(props.className,props.children),_onKeyDown=props.onKeyDown,otherprops=(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_objectWithoutProperties_js__WEBPACK_IMPORTED_MODULE_1__.Z)(props,_excluded2);return __jsx("input",(0,_home_runner_work_webui_webui_node_modules_babel_runtime_helpers_esm_extends_js__WEBPACK_IMPORTED_MODULE_2__.Z)({className:(0,tailwind_merge__WEBPACK_IMPORTED_MODULE_3__.m)("w-full h-8 px-2 pt-2 ","dark:border-neutral-400 dark:bg-neutral-800 bg-neutral-0 text-text-1000 dark:text-text-0 ","border rounded-sm","dark:border-2 dark:border-neutral-0",null!==(_props$className=props.className)&&void 0!==_props$className?_props$className:""),onKeyDown:function onKeyDown(e){"Enter"===e.key&&(null==onEnterkey||onEnterkey(e)),null==_onKeyDown||_onKeyDown(e)}},otherprops),children)};TextInput.displayName="TextInput";try{TextInput.displayName="TextInput",TextInput.__docgenInfo={description:"",displayName:"TextInput",props:{onEnterkey:{defaultValue:null,description:"",name:"onEnterkey",required:!1,type:{name:"((event: any) => void)"}}}},"undefined"!=typeof STORYBOOK_REACT_CLASSES&&(STORYBOOK_REACT_CLASSES["src/component-library/Input/TextInput.tsx#TextInput"]={docgenInfo:TextInput.__docgenInfo,name:"TextInput",path:"src/component-library/Input/TextInput.tsx#TextInput"})}catch(__react_docgen_typescript_loader_error){}}}]);