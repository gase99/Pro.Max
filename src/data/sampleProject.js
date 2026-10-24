const faDigits = (value) => String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

const lowerRows = [
  [80, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [100, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [98, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [100, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [98, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [98, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [30, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [98, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [98, 58, 73.4, 55, 7, { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1 }],
  [100, 58, 73.4, 55, 7, { bottom: 0, sides: 2, shelf: 0, rail: 0, back: 0 }],
  [98, 58, 73.4, 55, 7, { bottom: 0, sides: 2, shelf: 0, rail: 0, back: 0 }]
];

const upperRows = [
  [60, 90], [84, 100], [80, 90], [84, 90], [84, 90],
  [84, 90], [84, 90], [84, 90], [84, 90], [84, 90],
  [84, 90], [84, 50], [84, 90], [84, 90], [84, 90],
  [84, 90], [84, 90], [84, 90], [84, 90], [35, 90]
];

export const createSampleProject = () => {
  const lowerUnits = lowerRows.map(([width, depth, height, shelfDepth, railWidth, parts], index) => ({
    id: `sample-lower-${index + 1}`,
    type: 'lower',
    name: `یونیت زمینی ${faDigits(String(index + 1).padStart(2, '0'))}`,
    quantity: 1,
    width,
    depth,
    height,
    shelfDepth,
    railWidth,
    doorHeight: 73.4,
    autoDoors: true,
    parts: { ...parts, doors: null }
  }));

  const upperUnits = upperRows.map(([width, height], index) => ({
    id: `sample-upper-${index + 1}`,
    type: 'upper',
    name: `یونیت هوایی ${faDigits(String(index + 1).padStart(2, '0'))}`,
    quantity: 1,
    width,
    depth: 35,
    height,
    bottomDepth: 35,
    doorHeight: 92,
    autoDoors: true,
    parts: { sides: 2, bottom: 1, top: 1, shelf: 1, rail: 1, back: 1, doors: null }
  }));

  const drawer = {
    id: 'sample-drawer-1',
    type: 'drawer',
    name: 'کشوهای نمونه',
    count: 1,
    depth: 50,
    width: 90,
    height: 50
  };

  return {
    id: 'sample-project',
    name: 'پروژه نمونه',
    customer: '',
    notes: 'نمونه اولیه بر اساس فایل analiz pro.2.xlsx؛ اعداد و قواعد برش قابل ویرایش‌اند.',
    sourceFile: 'analiz pro.2.xlsx',
    createdAt: new Date().toISOString(),
    units: [...lowerUnits, ...upperUnits, drawer]
  };
};

export const createDefaultUnit = (type, index = 1) => {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `unit-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tag = faDigits(index);

  if (type === 'upper') {
    return {
      id,
      type,
      name: `یونیت هوایی جدید ${tag}`,
      quantity: 1,
      width: 80,
      depth: 35,
      height: 90,
      bottomDepth: 35,
      doorHeight: 92,
      autoDoors: true,
      parts: { sides: 2, bottom: 1, top: 1, shelf: 1, rail: 1, back: 1, doors: null }
    };
  }

  if (type === 'drawer') {
    return {
      id,
      type,
      name: `مجموعه کشو ${tag}`,
      count: 1,
      depth: 50,
      width: 90,
      height: 50
    };
  }

  return {
    id,
    type: 'lower',
    name: `یونیت زمینی جدید ${tag}`,
    quantity: 1,
    width: 80,
    depth: 58,
    height: 73.4,
    shelfDepth: 55,
    railWidth: 7,
    doorHeight: 73.4,
    autoDoors: true,
    parts: { bottom: 1, sides: 2, shelf: 1, rail: 1, back: 1, doors: null }
  };
};
