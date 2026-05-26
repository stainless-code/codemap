export interface Animal {
  species: string;
}

export interface Mammal extends Animal {
  warmBlooded: boolean;
}

export interface Pet {
  name: string;
}

export interface Both extends Animal, Pet {}

export class Dog extends Mammal implements Pet {
  breed: string;
}
