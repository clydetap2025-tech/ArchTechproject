// Fictional diary entries illustrated with the licensed photographs in demo/photos.
export const DEMO_VERSION = 2;

export async function loadDemoPhoto(name) {
  const response = await fetch(new URL('../demo/photos/' + name + '.jpg', import.meta.url));
  if (!response.ok) throw new Error('Не удалось открыть фото для демо');
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Повреждённое фото в демо');
  return new File([blob], name + '.jpg', { type: 'image/jpeg' });
}

export const DEMO_DAYS = [
  {
    date: '2026-10-18', photos: ['autumnAlley', 'autumnCocoa', 'autumnBench', 'autumnPond', 'autumnTrail'], song: 'Frank Sinatra Autumn Leaves',
    text: 'Гуляли с Аней по парку, всё было в жёлтых листьях. Холодно, пальцы мёрзли, но мы взяли какао в термосе и долго сидели на скамейке у пруда, разговаривали обо всём. Пахло мокрой листвой, где-то играл уличный саксофон.',
  },
  {
    date: '2026-11-12', photos: ['officeSkyline', 'officeMonitor', 'officeDesk', 'officeWindow'], song: 'Daft Punk Derezzed',
    text: 'Срочная сдача проекта. Всю ночь сидел в офисе, в наушниках электроника на повторе, третий энергетик. Код падал, тимлид писал каждые полчаса, нервы на пределе. В 3:40 всё собралось и заработало, и город за окном был весь в огнях.',
  },
  {
    date: '2026-07-25', photos: ['partyRoof', 'partyCake', 'partyLights', 'partyMelon'], song: 'Earth, Wind & Fire September',
    text: 'День рождения Марата на крыше! Солнце, жара, мы с друзьями танцевали до заката, ели арбуз и торт, кто-то принёс гирлянду. Смеялись так, что болели щёки.',
  },
  {
    date: '2026-11-05', photos: ['rainWindow', 'rainTea', 'rainStreet'], song: "Billie Eilish when the party's over",
    text: 'Весь вечер одна дома. За окном дождь, фонари размыты. Сделала чай, завернулась в плед и слушала одну и ту же песню. Немного грустно, немного спокойно — как будто весь мир на паузе.',
  },
  {
    date: '2026-08-14', photos: ['seaDawn', 'seaShore', 'seaTide', 'seaHorizon'], song: 'Ryuichi Sakamoto Merry Christmas Mr. Lawrence',
    text: 'Проснулся в пять утра и пошёл к морю, пока все спали. Тихо, только волны и чайки. Вода холодная и прозрачная, солнце только поднималось. Сидел на камне и ни о чём не думал.',
  },
  {
    date: '2026-09-06', photos: ['villageHouse', 'villageApples', 'villagePie', 'villageGarden'], song: 'Fleetwood Mac Dreams',
    text: 'Приехали к бабушке в деревню. Пахло яблоками и печкой, она испекла пирог, как в детстве. Вечером разбирали старые фотографии, бабушка рассказывала про свою молодость. Тепло и чуть-чуть грустно.',
  },
  {
    // signals disagree on purpose: a sad entry with a joyful song
    date: '2026-10-30', photos: ['movingBoxes', 'movingLamp', 'movingVinyl'], song: 'ABBA Dancing Queen',
    text: 'Последний вечер перед переездом. Разбирали коробки, в квартире стало пусто и немного грустно, стены голые, эхо. Но потом включили старую пластинку и танцевали прямо среди вещей, под одной лампой.',
  },
];
