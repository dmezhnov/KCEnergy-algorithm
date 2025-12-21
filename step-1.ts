import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import ScratchArr from 'lib/core/default/ScratchArr.bun';
import asArr from 'lib/core/custom/asArr.bun';
import { requests_by_period } from './initial_data.example'


const arrayToScratchFormat = <TEl>(array: TEl | asArr<TEl>): ScratchArr<TEl> => {
    //@ts-ignore
    return new ScratchArr(array);
}

export const requests_by_period_first_queue: MatrixBoi = new MatrixBoi();

export const requests_by_queue: MatrixBoi = new MatrixBoi();

export const requests_by_market_participant: MatrixBoi = new MatrixBoi();

export const requests_by_market_participant_region: MatrixBoi = new MatrixBoi();
