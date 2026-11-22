import { h } from './util.js';
import { ui } from './i18n.js';
import { visibilityLabels, visibilityOf } from './day-sharing.js';

export function visibilityPicker(value, onChange) {
  const select = h('select', { onchange: onChange },
    Object.entries(visibilityLabels).map(([key, label]) => h('option', { value: key }, ui(label))));
  select.value = visibilityOf(value);
  return {
    select,
    label: h('label', { class: 'visibility-picker' }, h('span', null, ui('Кто видит день')), select),
  };
}
