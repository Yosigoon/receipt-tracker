// api/analyze.js - Google Vision (최종 수정 버전)
const { google } = require('googleapis');
const vision = require('@google-cloud/vision');
const formidable = require('formidable');
const fs = require('fs');

module.exports = async (req, res) => {
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

        const receiptFile = Array.isArray(files.receipt) ? files.receipt[0] : files.receipt;

        if (!receiptFile) {
            console.error('No receipt file found:', files);
            return res.status(400).json({ error: '영수증 이미지가 필요합니다.' });
        }

        const filePath = receiptFile.filepath || receiptFile.path;
        console.log('Receipt file:', filePath);

        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
        console.log('Credentials loaded, project:', credentials.project_id);

        const client = new vision.ImageAnnotatorClient({
            credentials: credentials
        });

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

        const receiptData = parseReceiptText(fullText);
        console.log('Parsed receipt data:', receiptData);

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

function parseReceiptText(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);

    // === 날짜 찾기 ===
    let date = new Date().toISOString().split('T')[0];

    // 우선순위 1: "거래일시", "승인일시" 키워드
    for (const line of lines) {
        if (line.includes('거래일시') || line.includes('승인일시')) {
            const dateMatch = line.match(/(\d{4})[-.\/년](\d{1,2})[-.\/월](\d{1,2})/);
            if (dateMatch) {
                const year = dateMatch[1];
                const month = dateMatch[2].padStart(2, '0');
                const day = dateMatch[3].padStart(2, '0');
                date = `${year}-${month}-${day}`;
                console.log(`날짜 찾음 (거래일시): ${date}`);
                break;
            }
        }
    }

    // 우선순위 2: 일반 날짜 패턴
    if (date === new Date().toISOString().split('T')[0]) {
        const datePatterns = [
            /(\d{4})[-.\/년\s](\d{1,2})[-.\/월\s](\d{1,2})[일]?/,
            /(\d{2})[-.\/년\s](\d{1,2})[-.\/월\s](\d{1,2})[일]?/
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

                    // 유효한 날짜인지 확인
                    if (parseInt(month) >= 1 && parseInt(month) <= 12 &&
                        parseInt(day) >= 1 && parseInt(day) <= 31) {
                        date = `${year}-${month}-${day}`;
                        console.log(`날짜 찾음 (패턴): ${date}`);
                        break;
                    }
                }
            }
        }
    }

    // === 상호명 찾기 ===
    let store = '미상';

    // 우선순위 1: "가맹점", "상호" 키워드
    for (const line of lines) {
        if (line.includes('가맹점') || line.includes('상호')) {
            const match = line.match(/가맹점[:\s]*(.+)|상호[:\s]*(.+)/);
            if (match) {
                store = (match[1] || match[2]).trim();
                console.log(`상호 찾음 (키워드): ${store}`);
                break;
            }
        }
    }

    // 우선순위 2: 상호 관련 키워드가 있는 줄 (마트, 점, 식당 등)
    if (store === '미상') {
        const storeKeywords = ['마트', '점', '식당', '카페', '커피', '치킨', '피자', '버거', '약국', '병원', '편의점'];
        for (let i = 0; i < Math.min(10, lines.length); i++) {
            const line = lines[i];
            const hasStoreKeyword = storeKeywords.some(keyword => line.includes(keyword));

            if (hasStoreKeyword &&
                line.length > 3 &&
                line.length < 50 &&
                !line.match(/\d{3}-\d{2}-\d{5}/) &&  // 사업자번호 제외
                !line.match(/TEL|전화|연락처/i)) {
                store = line;
                console.log(`상호 찾음 (키워드 포함): ${store}`);
                break;
            }
        }
    }

    // 우선순위 3: 첫 5줄에서 찾기
    if (store === '미상') {
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const line = lines[i];
            if (line.length > 2 && line.length < 30 &&
                !line.match(/^\d+$/) &&
                !line.match(/\d{3}-\d{2}-\d{5}/) &&  // 사업자번호 형식 제외
                !line.includes('영수증') &&
                !line.includes('receipt') &&
                !line.includes('신용승인') &&
                !line.includes('고객용') &&
                !line.includes('단말기') &&
                !line.match(/\d{4}[-.\/]/)) {
                store = line;
                console.log(`상호 찾음 (첫 줄): ${store}`);
                break;
            }
        }
    }

    // === 금액 찾기 ===
    let amount = 0;
    const amountKeywords = ['합계', '총액', '총계', 'total', '받을금액', '카드금액', '승인금액', '결제금액', '지불액'];

    // 우선순위 1: "합" + "계" 분리된 경우
    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i];
        const nextLine = lines[i + 1] || '';
        const nextNextLine = lines[i + 2] || '';

        if (currentLine === '합' && nextLine === '계') {
            const amountMatch = nextNextLine.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})/);
            if (amountMatch) {
                amount = parseInt(amountMatch[1].replace(/,/g, ''));
                console.log(`금액 찾음 (합/계 분리): ${amount}`);
                break;
            }
        }

        // 키워드가 있는 경우
        const hasKeyword = amountKeywords.some(keyword => currentLine.includes(keyword));
        if (hasKeyword) {
            const sameLineMatch = currentLine.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})/);
            if (sameLineMatch) {
                amount = parseInt(sameLineMatch[1].replace(/,/g, ''));
                console.log(`금액 찾음 (키워드 같은 줄): ${amount}`);
                break;
            }

            const nextLineMatch = nextLine.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})/);
            if (nextLineMatch) {
                amount = parseInt(nextLineMatch[1].replace(/,/g, ''));
                console.log(`금액 찾음 (키워드 다음 줄): ${amount}`);
                break;
            }
        }
    }

    // 우선순위 2: "원" 근처
    if (amount === 0) {
        for (const line of lines) {
            if (line.includes('원') && !line.includes('요일') && !line.includes('월')) {
                const wonMatch = line.match(/(\d{1,3}(?:,\d{3})+|\d{4,6})\s*원/);
                if (wonMatch) {
                    amount = parseInt(wonMatch[1].replace(/,/g, ''));
                    console.log(`금액 찾음 (원): ${amount}`);
                    break;
                }
            }
        }
    }

    // 우선순위 3: 마지막 10줄
    if (amount === 0) {
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
            const line = lines[i];

            if (line.startsWith('*')) continue;
            if (line.includes('-') && line.match(/\d{3}-\d{2}-\d{5}/)) continue;
            if (line.match(/^[*]?\d{10,}/)) continue;

            const commaMatch = line.match(/(\d{1,3}(?:,\d{3})+)/);
            if (commaMatch) {
                const num = parseInt(commaMatch[1].replace(/,/g, ''));
                if (num >= 1000 && num < 1000000 && num > amount) {
                    amount = num;
                    console.log(`금액 찾음 (마지막): ${amount}`);
                }
            }
        }
    }

    // === 카테고리 추정 ===
    const category = categorizeByStore(store, text);

    // === 결제수단 ===
    let payment = '카드';
    const textLower = text.toLowerCase();
    if (textLower.includes('현금') || textLower.includes('cash')) {
        payment = '현금';
    } else if (textLower.includes('계좌') || textLower.includes('이체')) {
        payment = '계좌이체';
    }

    return { date, store, amount, category, payment };
}

function categorizeByStore(store, fullText) {
    const combinedText = (store + ' ' + fullText).toLowerCase();

    const categories = {
        '식비': [
            '마트', '마켓', '슈퍼', '식당', '음식점', '카페', '커피', '베이커리',
            '치킨', '피자', '버거', '맥도날드', '롯데리아', '버거킹', 'kfc',
            '편의점', 'cu', 'gs25', '세븐일레븐', '7-eleven',
            '이마트', '롯데마트', '홈플러스', '코스트코', '쿠팡',
            '배달', '요기요', '배달의민족', '쿠팡이츠',
            '스타벅스', '투썸', '이디야', '할리스', '탕'
        ],
        '교통': [
            '주유소', 'sk', 'gs칼텍스', '현대오일', 's-oil',
            '택시', '카카오택시', '버스', '지하철', '전철',
            '주차', '주차장', '파킹', '톨게이트', '통행료'
        ],
        '쇼핑': [
            '옷', '의류', '패션', '신발', '가방', '백화점', '아울렛',
            '화장품', '올리브영', '다이소', '쿠팡', '지마켓', '무신사'
        ],
        '생활': [
            '약국', '병원', '의원', '치과', '세탁', '미용실', '헤어샵'
        ],
        '여가': [
            '영화', 'cgv', '롯데시네마', '메가박스', '노래방', 'pc방', '헬스'
        ]
    };

    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(keyword => combinedText.includes(keyword))) {
            return category;
        }
    }

    return '기타';
}