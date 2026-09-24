export default async function handler(req, res) {
  // POST 요청만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'POST 요청만 지원합니다.' });
  }

  const { date, weightData, dietData, exerciseLogs } = req.body;

  // Vercel 환경변수에서 노션 키 불러오기
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    return res.status(500).json({ error: '노션 API 키 또는 데이터베이스 ID가 설정되지 않았습니다.' });
  }

  // --- 노션 페이지 본문(Block) 구성 ---
  const childrenBlocks = [];

  // 1. 체중 & 인바디 섹션
  childrenBlocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ text: { content: '⚖️ 체중 및 인바디 리포트' } }]
    }
  });

  if (weightData && weightData.weight) {
    childrenBlocks.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { text: { content: '오늘의 체중: ', annotations: { bold: true } } },
          { text: { content: `${weightData.weight}` } }
        ]
      }
    });
  }

  if (weightData && weightData.hasInbody) {
    const inbodyDetails = `골격근량: ${weightData.smm || '-'}kg | 체지방률: ${weightData.pbf || '-'}% | 체지방량: ${weightData.bfm || '-'}kg | BMI: ${weightData.bmi || '-'} | 내장지방: Lv.${weightData.visceral || '-'} | 기초대사량: ${weightData.bmr || '-'}kcal`;
    childrenBlocks.push({
      object: 'block',
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [
          { text: { content: '인바디 측정: ', annotations: { bold: true } } },
          { text: { content: inbodyDetails } }
        ]
      }
    });
  }

  // 구분선
  childrenBlocks.push({ object: 'block', type: 'divider', divider: {} });

  // 2. 식단 기록 섹션
  childrenBlocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ text: { content: '🍱 식단 기록' } }]
    }
  });

  const mealLabels = {
    breakfast: '아침 (Breakfast)',
    lunch: '점심 (Lunch)',
    dinner: '저녁 (Dinner)',
    snack: '간식 (Snack)'
  };

  let hasMeal = false;
  ['breakfast', 'lunch', 'dinner', 'snack'].forEach((mealKey) => {
    const meal = dietData?.[mealKey];
    if (meal && meal.food) {
      hasMeal = true;
      const timeStr = meal.time ? ` (${meal.time})` : '';
      const macroStr = `총 ${meal.cal}kcal (탄수화물 ${meal.carb}g / 단백질 ${meal.protein}g / 지방 ${meal.fat}g)`;

      childrenBlocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            { text: { content: `[${mealLabels[mealKey]}]${timeStr} `, annotations: { bold: true } } },
            { text: { content: `${meal.food} — ${macroStr}` } }
          ]
        }
      });
    }
  });

  if (!hasMeal) {
    childrenBlocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content: '기록된 식단이 없습니다.' } }] }
    });
  }

  // 구분선
  childrenBlocks.push({ object: 'block', type: 'divider', divider: {} });

  // 3. 운동 기록 섹션
  childrenBlocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ text: { content: '🏋️ 운동 기록' } }]
    }
  });

  if (exerciseLogs && exerciseLogs.length > 0) {
    exerciseLogs.forEach((log) => {
      childrenBlocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            { text: { content: `[${log.type}] ${log.name}: `, annotations: { bold: true } } },
            { text: { content: log.detail } }
          ]
        }
      });
    });
  } else {
    childrenBlocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content: '기록된 운동이 없습니다.' } }] }
    });
  }

  // --- Notion API 전송 ---
  try {
    const notionResponse = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
          'Title': {
            title: [{ text: { content: date } }]
          },
          'Date': {
            date: { start: date }
          }
        },
        children: childrenBlocks
      })
    });

    const result = await notionResponse.json();

    if (!notionResponse.ok) {
      console.error('Notion API Error:', result);
      return res.status(notionResponse.status).json({ error: result.message || '노션 API 연동 실패' });
    }

    return res.status(200).json({ success: true, pageId: result.id });
  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({ error: '서버 내부 에러가 발생했습니다.' });
  }
}