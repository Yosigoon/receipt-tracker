// api/analyze.js - Vercel Serverless Function (Google Vision)
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');
const formidable = require('formidable');
const fs = require('fs');

// 환경변수 필요:
// - GOOGLE_SHEETS_ID: 구글 시트 ID
// - GOOGLE_SERVICE_ACCOUNT: 서비스 계정 JSON (전체 내용)

module.exports = async (req, res) => {
    // CORS 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // 1. 파일 파싱 - formidable v3 방식
        const form = new formidable.IncomingForm({
            multiples: false,
            keepExtensions: true
        });

        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) {
                    console.error('Formidable parse error:', err);
                    reject(err);
                }
                console.log('Files received:', Object.keys(files));
                resolve({ fields, files });
            });
        });

        // formidable v3에서는 배열로 반환됨
        const receiptFile = Array.isArray(files.receipt) ? files.receipt[0] : files.receipt;
        if (!receiptFile) {
            console.error('No receipt file found:', files);
            return res.status(400).json({ error: '영수증 이미지가 필요합니다.' });
        }

        console.log('Receipt file:', receiptFile.filepath || receiptFile.path);

        // 2. Google Vision API로 OCR 수행
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        console.log('Credentials loaded, project:', credentials.project_id);
        const client = new vision.ImageAnnotatorClient({
            credentials: credentials
        });

        // formidable v3에서는 filepath 대신 path 사용 가능
        const filePath = receiptFile.filepath || receiptFile.path;
        const imageBuffer = fs.readFileSync(filePath);
        console.log('Image buffer size:', imageBuffer.length);

        const [result] = await client.textDetection(imageBuffer);
        console.log('Vision API response received');
        const detections = result.textAnnotations;

        if (!detections || detections.length === 0) {
            console.error('No text detected in image');
            return res.status(400).json({ error: '영수증에서 텍스트를 인식할 수 없습니다.' });
        }

        const fullText = detections[0].description;
        console.log('Detected text length:', fullText.length);
        console.log('Detected text preview:', fullText.substring(0, 200));

        // 3. 텍스트 파싱 (간단한 규칙 기반)
        const receiptData = parseReceiptText(fullText);
        console.log('Parsed receipt data:', receiptData);

        // 4. Google Sheets에 데이터 추가
        const auth = new google.auth.GoogleAuth({
            credentials: credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEETS_ID;

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'A:E',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    receiptData.date,
                    receiptData.store,
                    receiptData.amount,
                    receiptData.category,
                    receiptData.payment
                ]],
            },
        });

        console.log('Successfully added to sheet');

        // 5. 성공 응답
        res.status(200).json({
            success: true,
            message: '가계부에 기록되었습니다.',
            data: receiptData
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({
            error: '처리 중 오류가 발생했습니다.',
            details: error.message
        });
    }
};

// 영수증 텍스트 파싱 함수
function parseReceiptText(text) {
    const lines = text.split('\n');

    // 날짜 찾기 (YYYY-MM-DD, YYYY.MM.DD, YY-MM-DD 등)
    let date = new Date().toISOString().split('T')[0]; // 기본값: 오늘
    const datePatterns = [
        /(\d{4})[-.\/년](\d{1,2})[-.\/월](\d{1,2})[일]?/,
        /(\d{2})[-.\/년](\d{1,2})[-.\/월](\d{1,2})[일]?/
    ];

    for (const line of lines) {
        for (const pattern of datePatterns) {
            const match = line.match(pattern);
            if (match) {
                let year = match[1];
                if (year.length === 2) {
                    year = '20' + year;
                }
                const month = match[2].padStart(2, '0');
                const day = match[3].padStart(2, '0');
                date = `${year}-${month}-${day}`;
                break;
            }
        }
    }

    // 상호명 찾기 (보통 첫 줄 또는 두 번째 줄)
    let store = '미상';
    for (let i = 0; i < Math.min(5, lines.length); i++) {
        const line = lines[i].trim();
        // 너무 짧거나 긴 줄 제외, 숫자만 있는 줄 제외
        if (line.length > 2 && line.length < 30 &&
            !line.match(/^\d+$/) &&
            !line.includes('영수증') &&
            !line.includes('receipt')) {
            store = line;
            break;
        }
    }

    // 금액 찾기 (합계, 총액, total 등의 키워드 근처)
    let amount = 0;
    const amountKeywords = ['합계', '총액', '총계', 'total', '받을금액', '카드금액', '승인금액'];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        const hasKeyword = amountKeywords.some(keyword => line.includes(keyword));

        if (hasKeyword || line.includes('₩') || line.includes('원')) {
            // 현재 줄 또는 다음 줄에서 금액 찾기
            const searchLines = [lines[i], lines[i + 1], lines[i + 2]].filter(Boolean);
            for (const searchLine of searchLines) {
                // 콤마가 있는 숫자 또는 연속된 숫자 찾기
                const amountMatch = searchLine.match(/(\d{1,3}(?:,\d{3})+|\d{4,})/);
                if (amountMatch) {
                    const foundAmount = parseInt(amountMatch[1].replace(/,/g, ''));
                    // 너무 작거나 큰 금액 제외 (100원 ~ 1000만원)
                    if (foundAmount >= 100 && foundAmount < 10000000 && foundAmount > amount) {
                        amount = foundAmount;
                    }
                }
            }
        }
    }

    // 카테고리 추정 (상호명 기반)
    const category = categorizeByStore(store, text);

    // 결제수단 추정
    let payment = '카드';
    const textLower = text.toLowerCase();
    if (textLower.includes('현금') || textLower.includes('cash')) {
        payment = '현금';
    } else if (textLower.includes('계좌') || textLower.includes('이체')) {
        payment = '계좌이체';
    }

    return { date, store, amount, category, payment };
}

// 상호명으로 카테고리 추정
function categorizeByStore(store, fullText) {
    const combinedText = (store + ' ' + fullText).toLowerCase();

    const categories = {
        '식비': [
            '마트', '마켓', '슈퍼', '식당', '음식점', '카페', '커피', '베이커리',
            '치킨', '피자', '버거', '맥도날드', '롯데리아', '버거킹', 'kfc',
            '편의점', 'cu', 'gs25', '세븐일레븐', '7-eleven', 'mini stop',
            '이마트', '롯데마트', '홈플러스', '코스트코', '쿠팡',
            '배달', '요기요', '배달의민족', '쿠팡이츠',
            '스타벅스', '투썸', '이디야', '카페베네', '할리스',
            '김밥', '떡볶이', '분식', '족발', '보쌈', '찜닭', '삼겹살'
        ],
        '교통': [
            '주유소', 'sk', 'gs칼텍스', '현대오일', 's-oil', '에쓰오일',
            '택시', '카카오택시', '우버', '타다',
            '버스', '지하철', '전철', '교통카드',
            '주차', '주차장', '파킹',
            '톨게이트', '통행료', '하이패스'
        ],
        '쇼핑': [
            '옷', '의류', '패션', '신발', '구두', '운동화', '스니커즈',
            '가방', '백화점', '아울렛',
            '화장품', '올리브영', '세포라', '롭스',
            '다이소', '다이소',
            '온라인', '쿠팡', '11번가', '지마켓', 'g마켓',
            '무신사', '에이블리'
        ],
        '생활': [
            '약국', '약', '드럭스토어',
            '병원', '의원', '한의원', '치과', '안과', '내과',
            '세탁', '세탁소', '빨래방',
            '미용실', '헤어샵', '네일샵', '피부과',
            '클리닉', '동물병원'
        ],
        '여가': [
            '영화', 'cgv', '롯데시네마', '메가박스',
            '노래방', '코인노래방',
            'pc방', '피시방', '게임', '오락실',
            '헬스', '헬스장', '체육관', '피트니스', '요가',
            '볼링', '당구', '탁구', '수영장'
        ],
        '교육': [
            '서점', '교보문고', '영풍문고',
            '학원', '교습소', '과외',
            '문구', '문구점', '필기구'
        ]
    };

    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(keyword => combinedText.includes(keyword))) {
            return category;
        }
    }

    return '기타';
}