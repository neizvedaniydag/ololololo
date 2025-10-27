export const pushup = {
    name: 'pushup',
    title: 'Отжимания',
    defaultReps: 10,

    instructions: [
        'Упор лежа на прямых руках',
        'Тело образует прямую линию',
        'Опуститесь грудью почти до пола',
        'Локти согнуты на 90 градусов',
        'Выпрямите руки полностью'
    ],

    svgIcons: {
        bodyDown: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 10 L32 40 M26 34 L32 40 L38 34" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="42" width="8" height="3"/></svg>',
        bodyUp: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><path d="M32 40 L32 10 M26 16 L32 10 L38 16" stroke="white" stroke-width="3" fill="none"/><rect x="28" y="8" width="8" height="3"/></svg>',
        bodyStraight: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><rect x="20" y="28" width="24" height="4"/>ircle cx="20" cy="30" r="3"/"/>ircle cx="44" cy="="30" r="3"/></svg>',
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
    },

    thresholds: {
        elbowDown: 160,   // ОЧЕНЬ мягко - согнули хоть немного
        elbowUp: 170      // ОЧЕНЬ мягко - выпрямили
    },

    getInitialState() {
        return { position: 'up' };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        // Угол локтя
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = (elbowLeft + elbowRight) / 2;

        let result = { counted: false, correct: false, status: 'Готов' };

        // ПОКАЗЫВАЕМ УГОЛ НА ЭКРАНЕ ВСЕГДА
        const elbowRounded = Math.round(elbow);
        
        if (state.position === 'up') {
            // В верхней позиции - ждём опускания
            if (elbow < this.thresholds.elbowDown) {
                // ОПУСТИЛИСЬ!
                state.position = 'down';
                result.counted = true;
                result.correct = true;
                showHint(`✅ ЗАЧЁТ! Угол: ${elbowRounded}°`, this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
                result.status = '✅ Засчитано!';
            } else {
                // Ещё не опустились
                showHint(`Опускайтесь! Угол: ${elbowRounded}° (нужно <160°)`, this.svgIcons.bodyDown);
                result.status = `Опускайтесь (${elbowRounded}°)`;
            }
        } else {
            // В нижней позиции - ждём подъёма
            if (elbow > this.thresholds.elbowUp) {
                // ПОДНЯЛИСЬ!
                state.position = 'up';
                showHint(`Готов! Угол: ${elbowRounded}°`, this.svgIcons.bodyUp, 'rgba(16, 185, 129, 0.95)');
                result.status = 'Готов!';
            } else {
                // Ещё не поднялись
                showHint(`Выпрямляйтесь! Угол: ${elbowRounded}° (нужно >170°)`, this.svgIcons.bodyUp);
                result.status = `Выпрямляйтесь (${elbowRounded}°)`;
            }
        }

        return result;
    }
};
