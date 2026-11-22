import { h } from './util.js';
import { ui } from './i18n.js';
import { visibilityLabels, visibilityOf } from './day-sharing.js';

function visibilitySelect(value, labels, caption, onChange) {
  const select = h('select', { onchange: onChange },
    Object.entries(labels).map(([key, label]) => h('option', { value: key }, ui(label))));
  select.value = visibilityOf(value);
  return {
    select,
    label: h('label', { class: 'visibility-picker' }, h('span', null, ui(caption)), select),
  };
}

export function visibilityPicker(value, onChange) {
  return visibilitySelect(value, visibilityLabels, 'Кто видит день', onChange);
}

export function newDayVisibility() {
  const details = visibilitySelect('atmosphere', {
    atmosphere: 'Только атмосфера', full: 'Весь день',
  }, 'Что увидят друзья');
  const option = (value, label) => {
    const radio = h('input', { type: 'radio', name: 'day-audience', value, class: 'visually-hidden', onchange: update });
    return { radio, label: h('label', { class: 'day-audience-option' }, radio, ui(label)) };
  };
  const personal = option('private', 'Приватный');
  const friends = option('friends', 'Для друзей');
  friends.radio.checked = true;
  function update() {
    details.label.hidden = personal.radio.checked;
    details.select.disabled = personal.radio.checked;
  }
  return {
    element: h('fieldset', { class: 'field day-audience' }, h('legend', null, ui('Кто видит день')),
      h('div', { class: 'day-audience-options' }, personal.label, friends.label), details.label),
    get value() { return personal.radio.checked ? 'private' : details.select.value; },
  };
}
