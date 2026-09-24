export default async function handler(req, res) {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    return res.status(500).json({ error: '노션 API 키 또는 데이터베이스 ID가 설정되지 않았습니다.' });
  }

  const headers = {
    'Authorization': `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  // ----------------------------------------------------
  // 1. GET 요청: 노션 DB에서 오늘 날짜 데이터 불러오기
  // ----------------------------------------------------
  if (req.method === 'GET') {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: '날짜 파라미터가 필요합니다.' });

    try {
      // 오늘 날짜 페이지 검색
      const queryRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: {
            property: 'Date',
            date: { equals: date }
          }
        })
      });

      const queryData = await queryRes.json();
      if (!queryData.results || queryData.results.length === 0) {
        return res.status(200).json({ success: true, data: null });
      }

      const pageId = queryData.results[0].id;

      // 페이지 내부 블록 가져오기 (숨겨진 JSON 데이터 검색)
      const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, { headers });
      const blocksData = await blocksRes.json();

      let savedState = null;
      if (blocksData.results) {
        const jsonBlock = blocksData.results.find(
          b => b.type === 'code' && b.code && b.code.language === 'json'
        );
        if (jsonBlock && jsonBlock.code.rich_text.length > 0) {
          try {
            savedState = JSON.parse(jsonBlock.code.rich_text[0].plain_text);
          } catch (e) {
            console.error('JSON 파싱 실패:', e);
          }
        }
      }

      return res.status(200).json({ success: true, data: savedState, pageId });
    } catch (err) {
      console.error('GET Fetch Error:', err);
      return res.status(500).json({ error: '노션 데이터를 불러오는 중 오류가 발생했습니다.' });
    }
  }

  // ----------------------------------------------------
  // 2. POST 요청: 노션 DB로 데이터 자동 저장 / 동기화
  // ----------------------------------------------------
  if (req.method === 'POST') {
    const { date, weightData, dietData, exerciseLogs } = req.body;

    if (!date) return res.status(400).json({ error: '날짜 데이터가 없습니다.' });

    // 노션 용량 및 API 문자수 제한 방지를 위해 JSON 복사본 생성 (이미지 제외)
    const cleanDietData = JSON.parse(JSON.stringify(dietData || {}));
    Object.keys(cleanDietData).forEach(k => {
      if (cleanDietData[k]) cleanDietData[k].photo = '';
    });

    const rawJsonState = JSON.stringify({
      weightData,
      dietData: cleanDietData,
      exerciseLogs
    });

    // --- 노션 본문 블록 생성 ---
    const childrenBlocks = [];

    // 体重 & 인바디
    childrenBlocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: '⚖️ 체중 및 인바디 리포트' } }] }
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
      const details = `골격근량: ${weightData.smm || '-'}kg | 체지방률: ${weightData.pbf || '-'}% | 체지방량: ${weightData.bfm || '-'}kg | BMI: ${weightData.bmi || '-'} | 내장지방: Lv.${weightData.visceral || '-'} | 기초대사량: ${weightData.bmr || '-'}kcal`;
      childrenBlocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            { text: { content: '인바디 측정: ', annotations: { bold: true } } },
            { text: { content: details } }
          ]
        }
      });
    }

    childrenBlocks.push({ object: 'block', type: 'divider', divider: {} });

    // 식단 기록
    childrenBlocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: '🍱 식단 기록' } }] }
    });

    const mealLabels = { breakfast: '아침', lunch: '점심', dinner: '저녁', snack: '간식' };
    let hasMeal = false;
    ['breakfast', 'lunch', 'dinner', 'snack'].forEach((mealKey) => {
      const meal = dietData?.[mealKey];
      if (meal && meal.food) {
        hasMeal = true;
        const timeStr = meal.time ? ` (${meal.time})` : '';
        const macroStr = `총 ${meal.cal}kcal (탄 ${meal.carb}g / 단 ${meal.protein}g / 지 ${meal.fat}g)`;
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

    childrenBlocks.push({ object: 'block', type: 'divider', divider: {} });

    // 운동 기록
    childrenBlocks.push({
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: '🏋️ 운동 기록' } }] }
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

    // 양방향 동기화용 숨김 JSON 데이터 코드 블록
    childrenBlocks.push({ object: 'block', type: 'divider', divider: {} });
    childrenBlocks.push({
      object: 'block',
      type: 'code',
      code: {
        caption: [],
        rich_text: [{ type: 'text', text: { content: rawJsonState } }],
        language: 'json'
      }
    });

    try {
      // 1. 기존 페이지 있는지 확인
      const queryRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filter: { property: 'Date', date: { equals: date } }
        })
      });

      const queryData = await queryRes.json();

      if (queryData.results && queryData.results.length > 0) {
        // 기존 페이지 존재하는 경우: 기존 블록 삭제 후 새 블록 채우기
        const pageId = queryData.results[0].id;
        const oldBlocksRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, { headers });
        const oldBlocksData = await oldBlocksRes.json();

        if (oldBlocksData.results) {
          await Promise.all(
            oldBlocksData.results.map(block =>
              fetch(`https://api.notion.com/v1/blocks/${block.id}`, { method: 'DELETE', headers })
            )
          );
        }

        // 블록 갱신
        await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ children: childrenBlocks })
        });

        return res.status(200).json({ success: true, pageId, updated: true });
      } else {
        // 새로 생성
        const createRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: NOTION_DATABASE_ID },
            properties: {
              'Title': { title: [{ text: { content: date } }] },
              'Date': { date: { start: date } }
            },
            children: childrenBlocks
          })
        });

        const createData = await createRes.json();
        return res.status(200).json({ success: true, pageId: createData.id, created: true });
      }
    } catch (err) {
      console.error('POST Sync Error:', err);
      return res.status(500).json({ error: '노션 데이터 동기화 실패' });
    }
  }

  return res.status(405).json({ message: '허용되지 않는 메서드입니다.' });
}
