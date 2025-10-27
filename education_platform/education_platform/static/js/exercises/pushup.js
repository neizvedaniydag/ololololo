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
        bodyStraight: '<svg width="56" height="56" viewBox="0 0 64 64" fill="white"><rect x="20" y="28" width="24" height="4"/><circle cx="20" cy="30" r="3"/><circle cx="44" cy="30" r="3"/></svg>',
        check: '<svg width="48" height="48" viewBox="0 0 24 24" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
    },

    thresholds: {
        elbowDown: 165,   
        elbowUp: 170      
    },

    getInitialState() {
        return { position: 'up' };
    },

    analyze(lm, state, showHint, logError, calcAngle) {
        const elbowLeft = calcAngle(lm[11], lm[13], lm[15]);
        const elbowRight = calcAngle(lm[12], lm[14], lm[16]);
        const elbow = Math.round((elbowLeft + elbowRight) / 2);

        let result = { counted: false, correct: false, status: '' };

        // ЛОГИКА
        if (state.position === 'up' && elbow < this.thresholds.elbowDown) {
            // ЗАСЧИТАЛИ!
            state.position = 'down';
            result.counted = true;
            result.correct = true;
            result.status = `✅ ЗАЧЁТ! Угол был: ${elbow}°`;
            showHint('✅ ОТЛИЧНО!', this.svgIcons.check, 'rgba(16, 185, 129, 0.95)');
        }  
        else if (state.position === 'down' && elbow > this.thresholds.elbowUp) {
            // ПОДНЯЛИСЬ
            state.position = 'up';
            result.status = `Готов! Текущий угол: ${elbow}°`;
            showHint('Готов к следующему', this.svgIcons.bodyDown);
        }
        else {
            // ПРОМЕЖУТОЧНОЕ СОСТОЯНИЕ - ПОКАЗЫВАЕМ УГОЛ
            if (state.position === 'up') {
                result.status = `⬇️ Опускайтесь! Угол: ${elbow}° (надо <165°)`;
            } else {
                result.status = `⬆️ Выпрямляйтесь! Угол: ${elbow}° (надо >170°)`;
            }
        }

        return result;
    }
};
