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

export interface GenericBoth extends Animal, Map<string, Pet> {}

export class Dog extends Mammal implements Pet {
  breed: string;
}
