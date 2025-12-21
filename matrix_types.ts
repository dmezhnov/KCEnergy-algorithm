import { MatrixBoi } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/Matrix.bun';
import { CoordinateTypeReg } from 'lib/domen/kc-e.mybpm.kz/KCE/Группа/Матрицы/CoordinateType.bun.ts';
import { new_empty } from './matrix_operation';

export type axis = keyof typeof axis;
export const axis = {
    District: CoordinateTypeReg['District'],
    Product_category: CoordinateTypeReg['Product_category'],
}

export type index<TAxis extends axis> = number & { __axis: TAxis };

export type coordinate<TAxis extends axis = axis> = {
    axis: TAxis,
    index: index<TAxis>
}

export const coordinate: coordinate<axis> = {} as coordinate<axis>;

export interface matrix<
    TAxes extends axis[] = axis[],
    TAxis extends axis = TAxes[number]
> extends MatrixBoi {
    (...coords: coordinate<TAxis>[]): matrix<TAxes>
}

export const matrix = (
    <
        TAxes extends axis[] = axis[],
        TAxis extends axis = TAxes[number]
    >(...coords: coordinate<TAxis>[]): matrix<TAxes> => {
        return new_empty(...coords)
    }
) as unknown as matrix;



export default { axis, matrix, coordinate };
