// 视图控制只改显示状态。场景配置提供叠显所用的两个视图。
export function createViewControls(config, views, onChange) {
 const shadowControl = document.querySelector('#shadows');
 let shadowPreference = null;
 shadowControl.addEventListener('change', () => {
  shadowPreference = shadowControl.checked;
  onChange();
 });

 const underlays = config.foundation_underlays || {};
 let underlayControl, underlayInput;
 if (Object.keys(underlays).length) {
  underlayControl = document.createElement('div');
  underlayControl.hidden = true;
  const label = document.createElement('label');
  label.className = 'toggle';
  const caption = document.createElement('span');
  caption.textContent = 'Show foundation underneath / 叠加显示下方基础';
  underlayInput = document.createElement('input');
  underlayInput.type = 'checkbox';
  underlayInput.id = 'foundation-underlay';
  underlayInput.checked = true;
  underlayInput.addEventListener('change', onChange);
  label.append(caption, underlayInput);
  underlayControl.append(label);
  document.querySelector('#views').after(underlayControl);
 }

 return {
  sync(view, isPlan) {
   const shadows = shadowPreference ?? !isPlan;
   const foundation = views.get(underlays[view]);
   shadowControl.checked = shadows;
   if (underlayControl) underlayControl.hidden = !foundation;
   return {shadows, foundation: underlayInput?.checked ? foundation : undefined};
  },
 };
}
